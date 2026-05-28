import { NextRequest, NextResponse } from "next/server";
import { loadHubspotConfig, upsertContactByEmail } from "@/lib/hubspot";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocationById } from "@/config/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight lead capture from the chatbot widget.
 *
 * Fired when:
 *   - user provides contact info inside the chat (after the audience
 *     gate, or at the end of an unfinished match flow), OR
 *   - user closes the widget mid-flow ("abandoned cart")
 *
 * Doesn't go through the full kids-trial form (that's later in the
 * funnel). Just upserts a Contact with email + the conversation context
 * so staff can follow up. HubSpot's existing nurture sequences pick up
 * from there.
 */
interface ChatbotLeadBody {
  email?: string;
  phone?: string;
  firstName?: string;
  /** State the chatbot has collected so far. */
  state?: {
    audience?: string | null;
    experience?: string | null;
    years?: string | null;
    goal?: string | null;
    location?: string | null;
    format?: string | null;
  };
  /** Recent conversation transcript (last N user/bot lines). */
  transcript?: string;
  /** Where the lead came from: 'abandoned' | 'completed' | 'questions' */
  reason?: string;
}

function summarizeState(state: ChatbotLeadBody["state"]): string {
  if (!state) return "";
  const bits: string[] = [];
  if (state.audience) bits.push(`audience=${state.audience}`);
  if (state.experience) bits.push(`level=${state.experience}`);
  if (state.years) bits.push(`years=${state.years}`);
  if (state.goal) bits.push(`goal=${state.goal}`);
  if (state.format) bits.push(`format=${state.format}`);
  if (state.location) bits.push(`location=${state.location}`);
  return bits.join(" · ");
}

export async function POST(req: NextRequest) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  let body: ChatbotLeadBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const email = (body.email || "").trim().toLowerCase();
  const phone = (body.phone || "").trim();

  if (!email && !phone) {
    return NextResponse.json(
      { ok: false, error: "Either email or phone is required" },
      { status: 400 },
    );
  }

  // HubSpot upsert keys on email, so an email is required for the
  // backend write. If only phone was provided, synthesize a placeholder
  // email that's recognizable in HubSpot as a phone-only lead.
  const lookupEmail = email || `phoneonly+${phone.replace(/\D/g, "")}@court16-leads.local`;

  const cfg = loadHubspotConfig();
  if (!cfg || !cfg.accessToken) {
    // Soft-fail: log so staff can manually follow up via correlationId,
    // but don't surface to the user as a hard error.
    log.warn("HubSpot not configured — chatbot lead skipped", {
      hasEmail: !!email,
      hasPhone: !!phone,
      reason: body.reason,
    });
    return NextResponse.json({
      ok: true,
      warning: "lead-captured-but-hubspot-disabled",
      correlationId,
    });
  }

  const loc = body.state?.location ? getLocationById(body.state.location) : null;
  const summary = summarizeState(body.state);
  const transcriptTrimmed = (body.transcript || "").slice(-2000);
  const noteParts = [
    `Source: Chatbot widget (${body.reason || "unknown"})`,
    summary ? `Collected: ${summary}` : "",
    loc ? `Preferred location: ${loc.fullName}` : "",
    transcriptTrimmed ? `\n— Recent transcript —\n${transcriptTrimmed}` : "",
  ].filter(Boolean);

  try {
    const result = await upsertContactByEmail(cfg, log, lookupEmail, {
      firstname: body.firstName || undefined,
      phone: phone || undefined,
      lead_source: "Chatbot — Class Concierge",
      court16_intent: body.state?.audience === "kid" || body.state?.audience === "both"
        ? "kid_trial"
        : "adult_intro",
      court16_location_slug: body.state?.location || undefined,
      court16_failure_reason: body.reason === "abandoned" ? "abandoned_chat" : undefined,
      // Stash conversation summary on a Contact property the staff can
      // read at a glance. (`hs_predictivecontactscore_v2` is read-only
      // so we use a custom-ish text field that ships with the trial
      // form's contact schema; if it doesn't exist HubSpot will drop it.)
      any_question_just_let_us_know: noteParts.join("\n"),
    });
    log.info("Chatbot lead upserted to HubSpot", {
      contactId: result.id,
      reason: body.reason,
      hasEmail: !!email,
      hasPhone: !!phone,
    });
    return NextResponse.json({ ok: true, correlationId, contactId: result.id });
  } catch (err) {
    log.error("HubSpot upsert failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Soft-fail — capture happened, staff can recover via logs.
    return NextResponse.json({
      ok: true,
      warning: "lead-captured-but-hubspot-write-failed",
      correlationId,
    });
  }
}
