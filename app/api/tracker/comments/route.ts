import { NextResponse } from "next/server";
import { listComments, loadTrackerConfig } from "../_github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadTrackerConfig();
  if (!cfg) {
    // Tracker is still useful without comments — return an empty list so
    // the UI can render "no comments yet" instead of breaking.
    return NextResponse.json({ ok: true, comments: [], configured: false });
  }
  try {
    const comments = await listComments(cfg);
    return NextResponse.json({ ok: true, comments, configured: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `GitHub error: ${msg}` }, { status: 502 });
  }
}
