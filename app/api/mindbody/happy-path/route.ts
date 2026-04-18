import { NextResponse } from "next/server";
import {
  addClient,
  addClientRelationship,
  addClientToClass,
  checkCallerToken,
  getClientsByEmail,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HappyPathBody {
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    mobilePhone?: string;
    birthDate?: string;
  };
  child: {
    firstName: string;
    lastName: string;
    birthDate: string; // "YYYY-MM-DD"
  };
  /** Optional — if omitted, we skip the class-booking step. */
  classId?: number;
  /**
   * Guardian RelationshipId. MindBody's default catalog uses 20 for "Guardian".
   * Some sandboxes seed a custom catalog; override if yours differs.
   */
  relationshipId?: number;
}

export async function POST(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  let body: HappyPathBody;
  try {
    body = (await req.json()) as HappyPathBody;
  } catch {
    return NextResponse.json({ ok: false, correlationId, error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validate(body);
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, correlationId, errors }, { status: 400 });
  }

  let cfg;
  try {
    cfg = loadConfigFromEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }

  log.info("happy-path.start", {
    writeMode: cfg.writeMode,
    parentEmail: body.parent.email,
    childFirstName: body.child.firstName,
    classId: body.classId ?? null,
  });

  const trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }> = [];

  try {
    // 1. Look for the parent by email.
    const existing = await getClientsByEmail(cfg, log, body.parent.email);
    trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length, clients: existing } });

    // 2. Create or reuse parent.
    let parentId: string | number;
    if (existing.length > 0) {
      parentId = existing[0].Id;
      trace.push({ step: "addClient (parent)", status: "skipped", data: { reason: "already exists", parentId } });
    } else {
      const created = await addClient(cfg, log, {
        FirstName: body.parent.firstName,
        LastName: body.parent.lastName,
        Email: body.parent.email,
        MobilePhone: body.parent.mobilePhone,
        BirthDate: body.parent.birthDate,
      });
      parentId = created.Id;
      trace.push({ step: "addClient (parent)", status: "ok", data: created });
    }

    // 3. Create the child record. (Children are their own MindBody clients,
    //    linked to the parent via a Guardian relationship.)
    //    Children have no email address in MindBody — we use a synthetic one
    //    prefixed with "kid+" because the API requires a unique email.
    const childEmail = `kid+${Date.now()}@court16-test.invalid`;
    const child = await addClient(cfg, log, {
      FirstName: body.child.firstName,
      LastName: body.child.lastName,
      Email: childEmail,
      BirthDate: body.child.birthDate,
    });
    trace.push({ step: "addClient (child)", status: "ok", data: child });

    // 4. Link parent → child (Guardian).
    const relationshipId = body.relationshipId ?? 20;
    try {
      const rel = await addClientRelationship(cfg, log, {
        ClientId: parentId,
        RelatedClientId: child.Id,
        RelationshipId: relationshipId,
      });
      trace.push({ step: "addClientRelationship", status: "ok", data: rel });
    } catch (e) {
      // Non-fatal: some sandboxes don't have relationship id 20 seeded.
      log.warn("happy-path.relationship.fail", { error: serialize(e) });
      trace.push({ step: "addClientRelationship", status: "error", error: serialize(e) });
    }

    // 5. Optionally book the child into a class.
    if (body.classId !== undefined) {
      const booking = await addClientToClass(cfg, log, {
        ClientId: child.Id,
        ClassId: body.classId,
      });
      trace.push({ step: "addClientToClass", status: "ok", data: booking });
    } else {
      trace.push({ step: "addClientToClass", status: "skipped", data: { reason: "no classId supplied" } });
    }

    log.info("happy-path.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      writeMode: cfg.writeMode,
      parentId,
      childId: child.Id,
      trace,
    });
  } catch (e) {
    log.error("happy-path.fail", { error: serialize(e) });
    return NextResponse.json(
      { ok: false, correlationId, writeMode: cfg.writeMode, trace, error: serialize(e) },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}

function validate(body: HappyPathBody | undefined): string[] {
  if (!body) return ["Body is required"];
  const errors: string[] = [];
  if (!body.parent) errors.push("parent is required");
  if (!body.child) errors.push("child is required");
  if (body.parent && !body.parent.firstName) errors.push("parent.firstName is required");
  if (body.parent && !body.parent.lastName) errors.push("parent.lastName is required");
  if (body.parent && !/^\S+@\S+\.\S+$/.test(body.parent.email ?? "")) errors.push("parent.email is invalid");
  if (body.child && !body.child.firstName) errors.push("child.firstName is required");
  if (body.child && !body.child.lastName) errors.push("child.lastName is required");
  if (body.child && !/^\d{4}-\d{2}-\d{2}$/.test(body.child.birthDate ?? ""))
    errors.push('child.birthDate must be "YYYY-MM-DD"');
  return errors;
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
