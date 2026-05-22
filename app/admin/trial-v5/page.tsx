/**
 * Admin test page — compares v5 SOAP class-fetch against v6 REST for the
 * exact same query window + filters. Goal: confirm whether v5 surfaces
 * the Trial-CD-tagged class occurrences that v6 returns 0 for.
 *
 * Side-by-side layout:
 *   Left column  — v5 result (parsed from SOAP envelope)
 *   Right column — v6 result (same window, same Program 61 filter)
 *   Bottom      — raw v5 XML excerpt (when ?raw=true)
 *
 * Same auth as /admin/inventory: ?key=<INVENTORY_ACCESS_KEY> matched
 * against env var. notFound() if env var unset (leak-proof). 401 prompt
 * if key wrong.
 *
 * Query params accepted on the URL (defaults shown):
 *   key                       (required — INVENTORY_ACCESS_KEY)
 *   startDate=2026-05-26
 *   endDate=2026-06-28
 *   classDescriptionIds       (default: 137,138,139,140 = 4 Trial CDs)
 *   programIds                (default: 61)
 *   raw=true                  (include raw v5 XML for debugging)
 */

import { notFound } from "next/navigation";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { authedMindbodyGet } from "@/lib/mindbody";
import {
  getClassesV5,
  MindbodyV5Error,
  MindbodyV5MissingPasswordError,
  type ClassV5,
} from "@/lib/mindbody-v5";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_RH = "5748154";
const DEFAULT_CD_IDS = "137,138,139,140"; // 4 Trial CDs
const DEFAULT_PROGRAM_IDS = "61"; // Kid's Trials

interface QueryState {
  startDate: string;
  endDate: string;
  classDescriptionIds: number[];
  programIds: number[];
  raw: boolean;
}

function parseIdList(v: string | undefined): number[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function resolveQuery(params: {
  startDate?: string;
  endDate?: string;
  classDescriptionIds?: string;
  programIds?: string;
  raw?: string;
}): QueryState {
  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + 45);
  const defaultEnd = end.toISOString().slice(0, 10);
  return {
    startDate: params.startDate ?? defaultStart,
    endDate: params.endDate ?? defaultEnd,
    classDescriptionIds: parseIdList(params.classDescriptionIds ?? DEFAULT_CD_IDS),
    programIds: parseIdList(params.programIds ?? DEFAULT_PROGRAM_IDS),
    raw: params.raw === "true",
  };
}

async function fetchV5(query: QueryState) {
  const log = createLogger(makeCorrelationId());
  try {
    const r = await getClassesV5(log, {
      startDateTime: `${query.startDate}T00:00:00`,
      endDateTime: `${query.endDate}T23:59:59`,
      classDescriptionIds: query.classDescriptionIds.length
        ? query.classDescriptionIds
        : undefined,
      programIds: query.programIds.length ? query.programIds : undefined,
      hideCanceledClasses: false,
      schedulingWindow: false,
      includeRawXml: query.raw,
    });
    return { ok: true as const, data: r };
  } catch (e) {
    if (e instanceof MindbodyV5MissingPasswordError) {
      return { ok: false as const, error: e.message, kind: "missing-password" as const };
    }
    if (e instanceof MindbodyV5Error) {
      return {
        ok: false as const,
        error: e.message,
        kind: "v5-error" as const,
        v5Status: e.v5Status,
        v5ErrorCode: e.errorCode,
      };
    }
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      kind: "unknown" as const,
    };
  }
}

async function fetchV6(query: QueryState) {
  const log = createLogger(makeCorrelationId());
  try {
    // v6 supports comma-separated values in a single query param
    const cdIds = query.classDescriptionIds.length
      ? query.classDescriptionIds.join(",")
      : undefined;
    const pIds = query.programIds.length ? query.programIds.join(",") : undefined;
    const r = await authedMindbodyGet<{
      Classes?: Array<Record<string, unknown>>;
      PaginationResponse?: { TotalResults?: number };
    }>(log, {
      siteIdOverride: SITE_RH,
      path: "/class/classes",
      query: {
        StartDateTime: `${query.startDate}T00:00:00`,
        EndDateTime: `${query.endDate}T23:59:59`,
        ClassDescriptionIds: cdIds,
        ProgramIds: pIds,
        HideCanceledClasses: false,
        SchedulingWindow: false,
        Limit: 200,
      },
      consumerMode: true,
    });
    return { ok: true as const, data: r };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function Card({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        background: color === "v5" ? "#f3ecd2" : color === "v6" ? "#fffdf4" : "#fff",
        border: "1px solid var(--c16-line)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

function ClassRowV5({ c }: { c: ClassV5 }) {
  return (
    <li style={{ fontSize: 12, fontFamily: "var(--f-mono)", padding: "4px 0" }}>
      <span style={{ color: "var(--c16-ink-3)" }}>{c.Id}</span>{" "}
      <span>{c.StartDateTime?.slice(0, 16).replace("T", " ")}</span>{" "}
      <strong>{c.ClassDescriptionName ?? "(no name)"}</strong>{" "}
      <span style={{ color: "var(--c16-ink-3)" }}>· {c.StaffName ?? "?"}</span>{" "}
      <span style={{ color: "var(--c16-ink-3)" }}>
        · {c.TotalBooked ?? 0}/{c.MaxCapacity ?? 0}
      </span>
    </li>
  );
}

function ClassRowV6({ c }: { c: Record<string, unknown> }) {
  const cd = c.ClassDescription as { Name?: string } | undefined;
  const staff = c.Staff as { Name?: string } | undefined;
  return (
    <li style={{ fontSize: 12, fontFamily: "var(--f-mono)", padding: "4px 0" }}>
      <span style={{ color: "var(--c16-ink-3)" }}>{String(c.Id)}</span>{" "}
      <span>{String(c.StartDateTime).slice(0, 16).replace("T", " ")}</span>{" "}
      <strong>{cd?.Name ?? "(no name)"}</strong>{" "}
      <span style={{ color: "var(--c16-ink-3)" }}>· {staff?.Name ?? "?"}</span>{" "}
      <span style={{ color: "var(--c16-ink-3)" }}>
        · {String(c.TotalBooked ?? 0)}/{String(c.MaxCapacity ?? 0)}
      </span>
    </li>
  );
}

export default async function TrialV5Page({
  searchParams,
}: {
  searchParams: Promise<{
    key?: string;
    startDate?: string;
    endDate?: string;
    classDescriptionIds?: string;
    programIds?: string;
    raw?: string;
  }>;
}) {
  const expected = process.env.INVENTORY_ACCESS_KEY;
  if (!expected) notFound();

  const params = await searchParams;
  if (!params.key || params.key !== expected) {
    return (
      <main style={{ padding: 80, fontFamily: "var(--f-sans)", color: "var(--c16-ink-2)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Court 16 · Trial v5 test</h1>
        <p style={{ fontSize: 14, marginTop: 16 }}>
          Append <code>?key=&lt;INVENTORY_ACCESS_KEY&gt;</code> to access.
        </p>
      </main>
    );
  }

  const query = resolveQuery(params);

  // Parallel fetch — both calls hit the same window with the same filters.
  // Per-side error handling so one failure shows on its side without
  // killing the whole comparison.
  const [v5Result, v6Result] = await Promise.all([fetchV5(query), fetchV6(query)]);

  const v6Total = v6Result.ok
    ? (v6Result.data.PaginationResponse?.TotalResults ?? v6Result.data.Classes?.length ?? 0)
    : null;
  const v5Total = v5Result.ok ? v5Result.data.resultCount : null;

  return (
    <main
      style={{
        padding: "32px 24px 80px",
        fontFamily: "var(--f-sans)",
        color: "var(--c16-ink)",
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--c16-ink-3)",
            marginBottom: 6,
            fontFamily: "var(--f-mono)",
          }}
        >
          Cedarwind · Court 16 · v5 fork test
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>Trial calendar · v5 ↔ v6 diff</h1>
        <p style={{ fontSize: 14, color: "var(--c16-ink-3)", marginTop: 8 }}>
          Same window, same filters. If v5 surfaces classes that v6 returns 0 for, the visibility
          gap is real (v6-side). Site: <code>5748154 Ridge Hill</code>.
        </p>
      </header>

      {/* Query summary */}
      <div
        style={{
          background: "var(--c16-paper-2)",
          border: "1px solid var(--c16-line)",
          borderRadius: 8,
          padding: 14,
          marginBottom: 24,
          fontSize: 13,
          fontFamily: "var(--f-mono)",
        }}
      >
        <div>window: {query.startDate} → {query.endDate}</div>
        <div>
          classDescriptionIds:{" "}
          {query.classDescriptionIds.length ? query.classDescriptionIds.join(", ") : "(none)"}
        </div>
        <div>programIds: {query.programIds.length ? query.programIds.join(", ") : "(none)"}</div>
        <div>hideCanceledClasses: false · schedulingWindow: false</div>
      </div>

      {/* Side-by-side results */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {/* v5 column */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>
            v5 SOAP (Source-Password auth)
          </h2>
          <Card color="v5">
            {v5Result.ok ? (
              <>
                <div style={{ fontSize: 14, marginBottom: 12 }}>
                  <strong>resultCount: {v5Result.data.resultCount}</strong> ·{" "}
                  <span style={{ color: "var(--c16-ink-3)" }}>
                    parsed: {v5Result.data.classes.length}
                  </span>{" "}
                  · status: <code>{v5Result.data.status}</code>
                </div>
                {v5Result.data.classes.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--c16-ink-3)" }}>
                    No classes returned by v5 for this window + filter set.
                  </div>
                ) : (
                  <ul style={{ paddingLeft: 16, margin: 0 }}>
                    {v5Result.data.classes.slice(0, 80).map((c) => (
                      <ClassRowV5 key={c.Id} c={c} />
                    ))}
                  </ul>
                )}
              </>
            ) : v5Result.kind === "missing-password" ? (
              <div
                style={{
                  padding: 12,
                  background: "var(--c16-amber-soft)",
                  color: "var(--c16-amber)",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <strong>v5 unavailable:</strong> {v5Result.error}
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  Retrieve the Source Password from{" "}
                  <a
                    href="https://developers.mindbodyonline.com"
                    target="_blank"
                    style={{ color: "var(--c16-amber)" }}
                  >
                    developers.mindbodyonline.com
                  </a>{" "}
                  → Sources → CedarWindSolutionsLLC. Set as{" "}
                  <code>MINDBODY_SOURCE_PASSWORD</code> on Vercel + redeploy.
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: 12,
                  background: "var(--c16-red-soft)",
                  color: "var(--c16-red)",
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: "var(--f-mono)",
                }}
              >
                <strong>v5 error:</strong> {v5Result.error}
                {v5Result.kind === "v5-error" && (
                  <div style={{ marginTop: 6 }}>
                    Status: <code>{v5Result.v5Status}</code> · ErrorCode:{" "}
                    <code>{v5Result.v5ErrorCode}</code>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* v6 column */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>
            v6 REST (Api-Key auth, consumer-mode)
          </h2>
          <Card color="v6">
            {v6Result.ok ? (
              <>
                <div style={{ fontSize: 14, marginBottom: 12 }}>
                  <strong>TotalResults: {v6Total}</strong>
                </div>
                {(v6Result.data.Classes?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--c16-ink-3)" }}>
                    No classes returned by v6 for this window + filter set.
                  </div>
                ) : (
                  <ul style={{ paddingLeft: 16, margin: 0 }}>
                    {(v6Result.data.Classes ?? []).slice(0, 80).map((c, i) => (
                      <ClassRowV6 key={i} c={c} />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div
                style={{
                  padding: 12,
                  background: "var(--c16-red-soft)",
                  color: "var(--c16-red)",
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: "var(--f-mono)",
                }}
              >
                <strong>v6 error:</strong> {v6Result.error}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Verdict */}
      <div
        style={{
          background:
            v5Total != null && v6Total != null && v5Total > 0 && v6Total === 0
              ? "var(--c16-green-soft)"
              : "var(--c16-paper-2)",
          border: "1px solid var(--c16-line)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 28,
        }}
      >
        <strong style={{ fontSize: 14 }}>Verdict:</strong>{" "}
        {v5Total != null && v6Total != null ? (
          v5Total > 0 && v6Total === 0 ? (
            <span style={{ color: "var(--c16-green)", fontWeight: 600 }}>
              ✓ v5 surfaces {v5Total} classes that v6 hides. Visibility gap is real (v6-side).
            </span>
          ) : v5Total === v6Total ? (
            <span style={{ color: "var(--c16-ink-3)" }}>
              Both APIs return {v5Total} classes. No visibility gap detected.
            </span>
          ) : v5Total > 0 && v6Total > 0 ? (
            <span style={{ color: "var(--c16-amber)" }}>
              Both return data but different counts (v5: {v5Total}, v6: {v6Total}). Partial gap.
            </span>
          ) : v5Total === 0 && v6Total === 0 ? (
            <span style={{ color: "var(--c16-ink-3)" }}>
              Both APIs return 0 — data isn't visible to either surface (or filter is too narrow).
            </span>
          ) : null
        ) : (
          <span style={{ color: "var(--c16-ink-3)" }}>
            Can't compare yet — at least one side errored.{" "}
            {v5Result.ok === false && v5Result.kind === "missing-password"
              ? "Set MINDBODY_SOURCE_PASSWORD to activate v5."
              : ""}
          </span>
        )}
      </div>

      {/* Filter quick-flips */}
      <details style={{ marginBottom: 24 }}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
          Try other filter combinations
        </summary>
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
          <a
            href={`?key=${encodeURIComponent(params.key ?? "")}&classDescriptionIds=137,138,139,140`}
            style={{ display: "block", color: "var(--c16-ink)" }}
          >
            → Filter by all 4 Trial CDs (default)
          </a>
          <a
            href={`?key=${encodeURIComponent(params.key ?? "")}&classDescriptionIds=140`}
            style={{ display: "block", color: "var(--c16-ink)" }}
          >
            → Filter by Teenager Trial only (CD 140 — husband's URL test)
          </a>
          <a
            href={`?key=${encodeURIComponent(params.key ?? "")}&programIds=61`}
            style={{ display: "block", color: "var(--c16-ink)" }}
          >
            → Filter by Program 61 only (no CD filter)
          </a>
          <a
            href={`?key=${encodeURIComponent(params.key ?? "")}&classDescriptionIds=&programIds=`}
            style={{ display: "block", color: "var(--c16-ink)" }}
          >
            → No filters (full catalog — sanity check both APIs work)
          </a>
          <a
            href={`?key=${encodeURIComponent(params.key ?? "")}&raw=true`}
            style={{ display: "block", color: "var(--c16-ink)" }}
          >
            → Include raw v5 XML response (debug)
          </a>
        </div>
      </details>

      {/* Raw XML for debugging */}
      {v5Result.ok && v5Result.data.rawXml && (
        <details style={{ marginBottom: 24 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            Raw v5 SOAP response (XML)
          </summary>
          <pre
            style={{
              marginTop: 12,
              padding: 14,
              background: "var(--c16-paper)",
              border: "1px solid var(--c16-line)",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "var(--f-mono)",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {v5Result.data.rawXml.slice(0, 8000)}
            {v5Result.data.rawXml.length > 8000 && "\n... (truncated)"}
          </pre>
        </details>
      )}

      <p style={{ fontSize: 12, color: "var(--c16-ink-4)", marginTop: 28 }}>
        Source: <code>lib/mindbody-v5.ts</code> · <code>app/api/mindbody/calendar-v5/route.ts</code>{" "}
        · this page. v5 docs: SOAP WSDL at{" "}
        <a
          href="https://api.mindbodyonline.com/0_5/ClassService.asmx?WSDL"
          target="_blank"
          style={{ color: "var(--c16-ink-3)" }}
        >
          api.mindbodyonline.com/0_5/ClassService.asmx?WSDL
        </a>
      </p>
    </main>
  );
}
