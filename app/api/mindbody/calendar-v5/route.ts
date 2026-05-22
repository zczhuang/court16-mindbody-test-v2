/**
 * GET /api/mindbody/calendar-v5
 *
 * Read-only v5 SOAP variant of /api/mindbody/calendar — used by the
 * /admin/trial-v5 test page to compare visibility of trial class
 * occurrences against the v6 path. NOT wired into the public booking
 * flow.
 *
 * Auth: same INVENTORY_ACCESS_KEY gating as /admin/* — accepts
 * `?key=<value>` matching the env var, else 404 (leak-proof).
 *
 * Query params:
 *   startDate, endDate         : YYYY-MM-DD (required)
 *   classDescriptionIds        : comma-separated ints (optional)
 *   programIds                 : comma-separated ints (optional)
 *   classIds                   : comma-separated ints (optional)
 *   hideCanceledClasses        : "true" | "false" (default false)
 *   schedulingWindow           : "true" | "false" (default false)
 *   raw                        : "true" → include rawXml in response (debug)
 *
 * Response shape mirrors /api/mindbody/calendar where possible:
 *   { siteId, classes: [...], v5Status, v5ErrorCode, resultCount, rawXml? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import {
  getClassesV5,
  MindbodyV5Error,
  MindbodyV5MissingPasswordError,
} from "@/lib/mindbody-v5";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SITE_RH = "5748154";

function parseIdList(value: string | null): number[] | undefined {
  if (!value) return undefined;
  const ids = value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}

export async function GET(request: NextRequest) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  // Auth gate — same env var as the admin dashboard. notFound on miss
  // (don't reveal the route's existence to unauthenticated callers).
  const expected = process.env.INVENTORY_ACCESS_KEY;
  if (!expected) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key || key !== expected) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate + endDate required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
  }

  const opts = {
    startDateTime: `${startDate}T00:00:00`,
    endDateTime: `${endDate}T23:59:59`,
    classDescriptionIds: parseIdList(searchParams.get("classDescriptionIds")),
    programIds: parseIdList(searchParams.get("programIds")),
    classIds: parseIdList(searchParams.get("classIds")),
    hideCanceledClasses: searchParams.get("hideCanceledClasses") === "true",
    schedulingWindow: searchParams.get("schedulingWindow") === "true",
    includeRawXml: searchParams.get("raw") === "true",
  };

  try {
    const result = await getClassesV5(log, opts);
    return NextResponse.json({
      siteId: SITE_RH,
      v5Status: result.status,
      v5ErrorCode: result.errorCode,
      resultCount: result.resultCount,
      classes: result.classes,
      correlationId,
      ...(opts.includeRawXml && result.rawXml ? { rawXml: result.rawXml } : {}),
    });
  } catch (err) {
    if (err instanceof MindbodyV5MissingPasswordError) {
      log.warn("calendar-v5.no-password", {});
      return NextResponse.json(
        {
          error: "v5 fallback unavailable",
          detail: err.message,
          correlationId,
        },
        { status: 503 },
      );
    }
    if (err instanceof MindbodyV5Error) {
      log.error("calendar-v5.v5-error", {
        status: err.status,
        errorCode: err.errorCode,
        v5Status: err.v5Status,
      });
      return NextResponse.json(
        {
          error: err.message,
          v5Status: err.v5Status,
          v5ErrorCode: err.errorCode,
          correlationId,
        },
        { status: 502 },
      );
    }
    log.error("calendar-v5.unexpected", {
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return NextResponse.json(
      {
        error: "v5 GetClasses failed",
        detail: err instanceof Error ? err.message : String(err),
        correlationId,
      },
      { status: 502 },
    );
  }
}
