import { NextResponse } from "next/server";
import { listTodos, loadTrackerConfig } from "../_github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadTrackerConfig();
  if (!cfg) {
    return NextResponse.json({ ok: true, todos: [], configured: false });
  }
  try {
    const todos = await listTodos(cfg);
    return NextResponse.json({ ok: true, todos, configured: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `GitHub error: ${msg}` }, { status: 502 });
  }
}
