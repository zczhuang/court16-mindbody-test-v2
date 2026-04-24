import { NextResponse } from "next/server";
import { createTodo, loadTrackerConfig } from "../_github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TodoBody {
  owner?: string;
  task?: string;
  when?: string;
}

export async function POST(req: Request) {
  const cfg = loadTrackerConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Tracker to-do store is not configured (TRACKER_GITHUB_TOKEN missing).",
      },
      { status: 503 },
    );
  }

  let body: TodoBody;
  try {
    body = (await req.json()) as TodoBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const owner = (body.owner ?? "").trim();
  const task = (body.task ?? "").trim();
  const when = (body.when ?? "").trim();
  if (!owner) return NextResponse.json({ ok: false, error: "owner is required" }, { status: 400 });
  if (!task) return NextResponse.json({ ok: false, error: "task is required" }, { status: 400 });
  if (task.length > 400) {
    return NextResponse.json({ ok: false, error: "task max 400 chars" }, { status: 400 });
  }
  if (when.length > 80) {
    return NextResponse.json({ ok: false, error: "when max 80 chars" }, { status: 400 });
  }

  try {
    const issue = await createTodo(cfg, owner, task, when);
    return NextResponse.json({ ok: true, id: issue.number });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `GitHub error: ${msg}` }, { status: 502 });
  }
}
