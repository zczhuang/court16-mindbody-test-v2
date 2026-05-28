import { NextRequest, NextResponse } from "next/server";
import { callGemini, GeminiMessage } from "@/lib/gemini";
import { CHATBOT_KB } from "@/lib/chatbot-kb";
import { authedMindbodyGet } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocationById, LOCATIONS } from "@/config/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CHATBOT_GEMINI_MODEL || "gemini-3.1-flash-lite";

interface AskBody {
  /** Conversation so far. Last entry should be the user's new message. */
  messages: { role: "user" | "model"; text: string }[];
  /** Snapshot of widget state — what the user has already chosen. */
  state?: {
    audience?: string | null;
    experience?: string | null;
    years?: string | null;
    goal?: string | null;
    location?: string | null;
    format?: string | null;
  };
}

// Vertex's responseSchema enums reject empty strings, so we model the
// "unchanged" case as the literal string "none" and strip it server-side.
const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    suggested: {
      type: "object",
      properties: {
        location:   { type: "string", enum: ["brooklyn","lic","fidi","yonkers","philly","newton","none"] },
        experience: { type: "string", enum: ["never","beginner","advBeginner","intermediate","advanced","none"] },
        format:     { type: "string", enum: ["group","semi","private","none"] },
        openBookingFlow: { type: "boolean" },
      },
      required: ["location","experience","format","openBookingFlow"],
    },
  },
  required: ["reply","suggested"],
} as const;

/** Pull up to N live MindBody slots for the user's chosen location and shape
 *  them into a compact bullet list the LLM can quote. */
async function buildLiveSlotsContext(stateLoc: string | null | undefined): Promise<string> {
  if (!stateLoc) return "";
  // map widget loc key → backend api key (yonkers → ridgehill)
  const apiLocMap: Record<string, string> = { yonkers: "ridgehill" };
  const apiLoc = apiLocMap[stateLoc] || stateLoc;
  const loc = getLocationById(apiLoc);
  if (!loc) return "";

  const log = createLogger(makeCorrelationId());
  const today = new Date();
  const end = new Date(today.getTime() + 14 * 864e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
    const siteId = useSandbox ? process.env.MINDBODY_SITE_ID! : String(loc.siteId);
    const result = await authedMindbodyGet<{ Classes?: any[] }>(log, {
      siteIdOverride: siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${fmt(today)}T00:00:00`,
        EndDateTime: `${fmt(end)}T23:59:59`,
        Limit: 200,
      },
    });
    const classes = (result?.Classes ?? []) as any[];
    const future = classes
      .filter(c => !c.IsCanceled)
      .filter(c => (c.MaxCapacity ?? 0) - (c.TotalBooked ?? 0) > 0)
      .filter(c => (c.StartDateTime || "") >= fmt(today))
      .sort((a, b) => (a.StartDateTime || "").localeCompare(b.StartDateTime || ""))
      .slice(0, 20);

    if (future.length === 0) return "\nLIVE SLOTS (next 14d, MindBody): none open.\n";

    const lines = future.map(c => {
      const name = c.ClassName || c?.ClassDescription?.Name || "Adult class";
      const coach = c?.Staff?.DisplayName || "TBD";
      const open = (c.MaxCapacity ?? 0) - (c.TotalBooked ?? 0);
      return `- ${c.StartDateTime} · ${name} · coach ${coach} · ${open} spots open`;
    });
    return `\nLIVE SLOTS (next 14d, MindBody, ${LOCATIONS.find(l => l.id === apiLoc)?.fullName ?? apiLoc}):\n${lines.join("\n")}\n`;
  } catch (e) {
    return "\nLIVE SLOTS: (unavailable right now — don't fabricate times)\n";
  }
}

export async function POST(req: NextRequest) {
  let body: AskBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ ok: false, error: "messages required" }, { status: 400 });
  }

  const state = body.state || {};
  const liveSlots = await buildLiveSlotsContext(state.location);

  const stateBlock = `
CURRENT USER STATE (what they've already chosen in the deterministic flow):
- experience: ${state.experience || "(unset)"}
- years played: ${state.years || "(unset)"}
- goal: ${state.goal || "(unset)"}
- audience: ${state.audience || "(unset — bot must infer kid vs adult from message)"}
- location: ${state.location || "(unset)"}
- format: ${state.format || "(unset)"}
`.trim();

  const sys = `
You are the Court 16 Class Concierge — a friendly, concise tennis-coordinator chatbot
embedded on court16.com. You handle BOTH adult players AND parents booking for their
kids with EQUAL ability. Never tell a parent you "specialize in adult tennis" — the
kids academy and free trial are first-class destinations on the same site, and you
route parents into them confidently.

You answer questions OUTSIDE the deterministic quick-reply flow (pricing follow-ups,
comparisons, schedule questions, policy, "what's open Saturday morning", "want to
book for my kids", etc.) and nudge the user back toward the right booking funnel.

${CHATBOT_KB}

${stateBlock}
${liveSlots}

RESPONSE FORMAT — strict JSON:
{
  "reply": "<the chat message to show the user, 1–3 short sentences, conversational>",
  "suggested": {
    "location":   "<brooklyn|lic|fidi|yonkers|philly|newton, or 'none' if unchanged>",
    "experience": "<never|beginner|advBeginner|intermediate|advanced, or 'none'>",
    "format":     "<group|semi|private, or 'none'>",
    "openBookingFlow": <true ONLY if the user clearly asked to book and location supports it>
  }
}

The "suggested" object is how you nudge the deterministic widget forward:
- Only set a field if the user just expressed that preference in their latest message
  (e.g. "I'm in Brooklyn" → location: "brooklyn"). Otherwise use "none".
- Only set openBookingFlow: true when the user explicitly says they want to book
  AND state.location is "yonkers" (the only location with online ADULT booking enabled).
  For KIDS booking, leave openBookingFlow=false — the widget's audience gate sends
  them to /trial through its own deterministic path.

ROUTING RULES — when the user mentions kids:
- ALWAYS acknowledge warmly and offer the FREE TRIAL (it's free, no card needed,
  every club). Mention the trial flow on this site, NOT court16.com/locations.
- Never decline. Never say "I only do adults". The kids trial is a primary product.
- If you don't know which club they want, ask.

ROUTING RULES — when the user mentions themselves:
- Use the adult pricing tables. Quote real numbers from above.
- For Ridge Hill, offer the $75 Tennis Intro in-chat.

For Newton pricing questions (adults OR kids), you MUST NOT invent numbers.
Say it's not published yet and offer a staff handoff.
`.trim();

  const geminiMessages: GeminiMessage[] = messages.map(m => ({
    role: m.role === "model" ? "model" : "user",
    text: String(m.text || ""),
  }));

  try {
    const out = await callGemini({
      model: MODEL,
      systemInstruction: sys,
      messages: geminiMessages,
      responseSchema: SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.4,
      maxOutputTokens: 400,
    });

    const parsed = (out.json as { reply?: string; suggested?: Record<string, unknown> } | undefined) || {};
    const reply = String(parsed.reply || out.text || "").trim();
    if (!reply) {
      return NextResponse.json({ ok: false, error: "Empty LLM reply" }, { status: 502 });
    }

    // Strip '' suggestions so the client can just merge truthy fields.
    const suggested: Record<string, unknown> = {};
    const s = (parsed.suggested ?? {}) as Record<string, unknown>;
    for (const k of ["location", "experience", "format"]) {
      const v = s[k];
      if (typeof v === "string" && v !== "" && v !== "none") suggested[k] = v;
    }
    if (s.openBookingFlow === true) suggested.openBookingFlow = true;

    return NextResponse.json({ ok: true, reply, suggested, model: MODEL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
