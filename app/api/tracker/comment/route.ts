import { NextResponse } from "next/server";
import { createComment, loadTrackerConfig } from "../_github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommentBody {
  from?: string;
  text?: string;
}

export async function POST(req: Request) {
  const cfg = loadTrackerConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Tracker comment store is not configured (TRACKER_GITHUB_TOKEN missing).",
      },
      { status: 503 },
    );
  }

  let body: CommentBody;
  try {
    body = (await req.json()) as CommentBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const from = (body.from ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!from) return NextResponse.json({ ok: false, error: "from is required" }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ ok: false, error: "text max 4000 chars" }, { status: 400 });
  }

  try {
    const issue = await createComment(cfg, from, text);
    return NextResponse.json({ ok: true, id: issue.number });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `GitHub error: ${msg}` }, { status: 502 });
  }
}
