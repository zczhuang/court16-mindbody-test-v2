import { NextResponse } from "next/server";
import {
  checkCallerToken,
  filterClassesByAgeBand,
  getClasses,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocation } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calendar?location=<slug>&ageMin=&ageMax=&programType=trial|intro&limit=20
 *
 * Thin wrapper around MindBody GetClasses with our own location-slug lookup
 * and in-process age-band filtering. Program-type filtering (trial-eligible
 * vs intro-eligible) applies once `trialProgramIds` / `introProgramIds` in
 * lib/config.ts are populated with real IDs.
 */
export async function GET(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const locationSlug = url.searchParams.get("location");
  const ageMin = numOrUndef(url.searchParams.get("ageMin"));
  const ageMax = numOrUndef(url.searchParams.get("ageMax"));
  const programType = url.searchParams.get("programType") as "trial" | "intro" | null;
  const limit = numOrUndef(url.searchParams.get("limit")) ?? 20;

  if (!locationSlug) {
    return NextResponse.json(
      { ok: false, correlationId, error: "location is required" },
      { status: 400 },
    );
  }

  const location = getLocation(locationSlug);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown location: ${locationSlug}` },
      { status: 400 },
    );
  }

  let cfg;
  try {
    cfg = loadConfigFromEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }

  // Per-location MindBody SiteId override. For Track 1 this is the
  // validated -99 sandbox across all locations; production site IDs slot in
  // via lib/config.ts once Anthony provides them.
  const siteCfg = { ...cfg, siteId: location.mindbodySiteId };

  const startDateTime = new Date().toISOString();
  const endDateTime = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

  try {
    const allClasses = await getClasses(siteCfg, log, { startDateTime, endDateTime, limit: 100 });
    const ageFiltered = filterClassesByAgeBand(allClasses, ageMin, ageMax);
    const programFiltered = filterByProgram(ageFiltered, programType, location);
    return NextResponse.json({
      ok: true,
      correlationId,
      location: location.slug,
      classes: programFiltered.slice(0, limit),
    });
  } catch (e) {
    const payload = e instanceof MindbodyError ? e.toJSON() : e instanceof Error ? { message: e.message } : e;
    return NextResponse.json(
      { ok: false, correlationId, error: payload },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}

function numOrUndef(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function filterByProgram(
  classes: Awaited<ReturnType<typeof getClasses>>,
  programType: "trial" | "intro" | null,
  location: ReturnType<typeof getLocation>,
) {
  if (!programType || !location) return classes;
  const allow =
    programType === "trial" ? location.trialProgramIds : location.introProgramIds;
  // Empty allowlist = "not yet configured, show everything" — intentional
  // Track 1 default until per-location program IDs are captured.
  if (allow.length === 0) return classes;
  return classes.filter((c) => {
    const pid = (c as unknown as { ProgramId?: number }).ProgramId;
    return typeof pid === "number" && allow.includes(pid);
  });
}
