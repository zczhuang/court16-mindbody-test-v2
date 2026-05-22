/**
 * MindBody Public API v0.5 (SOAP) — minimal client for the kid-trials
 * visibility experiment.
 *
 * Why this exists:
 *   v6 /class/classes returns 0 occurrences for Program 61 (Kid's Trials)
 *   ClassDescriptions 137-140 despite Ibtissam confirming she scheduled
 *   them in MindBody Business admin + her husband's tool retrieving them
 *   via v5. Definitively confirmed via 7 probe variants on May 22.
 *
 *   This client is a forked-test surface that hits v5 SOAP directly. If
 *   v5 surfaces the classes, the visibility gap is real (v6-side) and we
 *   gain the option to fall back to v5 for class reads while keeping
 *   v6 for everything else (AddClient, ContactRelationships, etc.).
 *
 * Auth model (different from v6):
 *   v5 SOAP requires a `SourceCredentials` element with SourceName +
 *   `Password` — NOT the same as the v6 Api-Key. The "Source Password" is
 *   a separate credential issued by MindBody developer portal. Stored as
 *   `MINDBODY_SOURCE_PASSWORD` env var. If missing, this client throws
 *   `MindbodyV5MissingPasswordError` so callers can degrade cleanly.
 *
 * Service endpoint:
 *   https://api.mindbodyonline.com/0_5/ClassService.asmx
 *   (Confirmed live May 22 — WSDL probe returned 94 KB schema; SOAP
 *    envelopes are parsed and validated server-side, just need correct
 *    credentials to authorize.)
 *
 * Deprecation: v5 is on MindBody's EOL roadmap (no firm date). Treat
 * everything here as load-bearing-but-temporary. When MindBody fixes
 * the v6 visibility issue (or sunsets v5), delete this file.
 *
 * Dependencies: none. Uses fetch + regex-based XML extraction.
 */

import type { Logger } from "./logger";

const V5_ENDPOINT = "https://api.mindbodyonline.com/0_5/ClassService.asmx";
const V5_NAMESPACE = "http://clients.mindbodyonline.com/api/0_5";

const SOURCE_NAME = "CedarWindSolutionsLLC"; // matches MINDBODY_API_KEY's registered source

export class MindbodyV5Error extends Error {
  status: number;
  errorCode?: number;
  v5Status?: string;
  constructor(msg: string, status: number, errorCode?: number, v5Status?: string) {
    super(msg);
    this.name = "MindbodyV5Error";
    this.status = status;
    this.errorCode = errorCode;
    this.v5Status = v5Status;
  }
}

export class MindbodyV5MissingPasswordError extends Error {
  constructor() {
    super(
      "MINDBODY_SOURCE_PASSWORD env var not set. v5 SOAP fallback is unavailable. " +
        "Retrieve the Source Password from developers.mindbodyonline.com under " +
        "Sources → CedarWindSolutionsLLC.",
    );
    this.name = "MindbodyV5MissingPasswordError";
  }
}

function loadV5Config(): { sourcePassword: string; siteId: number } {
  const sourcePassword = process.env.MINDBODY_SOURCE_PASSWORD;
  if (!sourcePassword) throw new MindbodyV5MissingPasswordError();
  // SiteId for this test surface is hardcoded to RH (5748154) since that's
  // the only site Cedarwind's API key has authorization on. Multi-site
  // support comes when we scale.
  return { sourcePassword, siteId: 5748154 };
}

export interface GetClassesV5Opts {
  /** Inclusive start. "YYYY-MM-DDTHH:MM:SS" (no TZ). */
  startDateTime: string;
  /** Inclusive end. "YYYY-MM-DDTHH:MM:SS" (no TZ). */
  endDateTime: string;
  /** Optional filter — restrict to specific Class Description IDs. */
  classDescriptionIds?: number[];
  /** Optional filter — specific Program IDs. */
  programIds?: number[];
  /** Optional filter — specific Class IDs. */
  classIds?: number[];
  /** Default false to include canceled (so we don't accidentally narrow). */
  hideCanceledClasses?: boolean;
  /** Default false to ignore the per-class scheduling window for visibility. */
  schedulingWindow?: boolean;
  /** Page size. v5 default is 25; we set 200 to match v6's typical Limit. */
  pageSize?: number;
}

/**
 * Class shape after v5 → normalized parse. Maps to roughly the same fields
 * the existing TrialClass adapter expects (so consumers can compose with
 * little extra glue).
 */
export interface ClassV5 {
  Id: number;
  ClassScheduleId?: number;
  ClassDescriptionId?: number;
  ProgramId?: number;
  ClassDescriptionName?: string;
  ProgramName?: string;
  StaffName?: string;
  StartDateTime: string; // "YYYY-MM-DDTHH:MM:SS"
  EndDateTime: string;
  MaxCapacity?: number;
  TotalBooked?: number;
  WebCapacity?: number;
  WebBooked?: number;
  IsAvailable?: boolean;
  IsCanceled?: boolean;
}

export interface GetClassesV5Response {
  status: string; // "Success" | "InvalidCredentials" | etc.
  errorCode: number;
  resultCount: number;
  classes: ClassV5[];
  /** Raw XML for debugging — only populated when called via the admin/test page. */
  rawXml?: string;
}

/** Escape XML special chars in user-provided values to prevent envelope corruption. */
function escapeXml(s: string | number | boolean | undefined | null): string {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function intArrayXml(label: string, ids: number[] | undefined): string {
  if (!ids || ids.length === 0) return "";
  const items = ids.map((n) => `      <int>${Number(n)}</int>`).join("\n");
  return `    <${label}>\n${items}\n    </${label}>`;
}

function buildGetClassesEnvelope(
  opts: GetClassesV5Opts,
  cfg: { sourcePassword: string; siteId: number },
): string {
  const hideCanceled = opts.hideCanceledClasses ?? false;
  const schedulingWindow = opts.schedulingWindow ?? false;
  const pageSize = opts.pageSize ?? 200;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetClasses xmlns="${V5_NAMESPACE}">
      <Request>
        <SourceCredentials>
          <SourceName>${escapeXml(SOURCE_NAME)}</SourceName>
          <Password>${escapeXml(cfg.sourcePassword)}</Password>
          <SiteIDs>
            <int>${cfg.siteId}</int>
          </SiteIDs>
        </SourceCredentials>
        <PageSize>${pageSize}</PageSize>
        <CurrentPageIndex>0</CurrentPageIndex>
${intArrayXml("ClassDescriptionIDs", opts.classDescriptionIds)}
${intArrayXml("ClassIDs", opts.classIds)}
        <StartDateTime>${escapeXml(opts.startDateTime)}</StartDateTime>
        <EndDateTime>${escapeXml(opts.endDateTime)}</EndDateTime>
${intArrayXml("ProgramIDs", opts.programIds)}
        <HideCanceledClasses>${hideCanceled}</HideCanceledClasses>
        <SchedulingWindow>${schedulingWindow}</SchedulingWindow>
      </Request>
    </GetClasses>
  </soap:Body>
</soap:Envelope>`;
}

/** Extract the first `<TagName>...</TagName>` value inside `block`. */
function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : undefined;
}

function extractInt(block: string, tag: string): number | undefined {
  const v = extractTag(block, tag);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractBool(block: string, tag: string): boolean | undefined {
  const v = extractTag(block, tag);
  if (v === undefined) return undefined;
  return v.toLowerCase() === "true";
}

/**
 * Minimal v5 SOAP response parser. We don't need a full XML AST — just
 * extract the `<Class>` blocks + the fields we care about for the
 * calendar UI. Avoids adding fast-xml-parser as a dep.
 *
 * If MindBody changes the response shape (unlikely on v5 since it's
 * frozen), the regex extractions here will silently miss fields. Worth
 * a periodic eyeball check via /admin/trial-v5?debug=raw to see the XML.
 */
function parseGetClassesResponse(xml: string): GetClassesV5Response {
  const status = extractTag(xml, "Status") ?? "Unknown";
  const errorCode = extractInt(xml, "ErrorCode") ?? -1;
  const resultCount = extractInt(xml, "ResultCount") ?? 0;

  if (status !== "Success") {
    // v5 returns HTTP 200 even on auth failure — surface via Status element.
    const msg = extractTag(xml, "Message") ?? "Unknown v5 error";
    throw new MindbodyV5Error(`v5 GetClasses ${status}: ${msg}`, 200, errorCode, status);
  }

  // Find all <Class>...</Class> blocks (top-level inside <Classes>). Note
  // that the parent element is <Classes> (plural), and each child is
  // <Class>. We split on the closing </Class> to capture individual blocks
  // rather than relying on a single regex with global flag — safer for
  // nested tags.
  const classesContainer = extractTag(xml, "Classes") ?? "";
  if (!classesContainer) {
    return { status, errorCode, resultCount, classes: [] };
  }
  const blocks: string[] = [];
  const re = /<Class\b[\s\S]*?<\/Class>/g;
  for (const m of classesContainer.matchAll(re)) blocks.push(m[0]);

  const classes: ClassV5[] = blocks.map((block) => ({
    Id: extractInt(block, "ID") ?? extractInt(block, "Id") ?? 0,
    ClassScheduleId: extractInt(block, "ClassScheduleID") ?? extractInt(block, "ClassScheduleId"),
    ClassDescriptionId:
      extractInt(extractTag(block, "ClassDescription") ?? "", "ID") ??
      extractInt(extractTag(block, "ClassDescription") ?? "", "Id"),
    ProgramId:
      extractInt(extractTag(extractTag(block, "ClassDescription") ?? "", "Program") ?? "", "ID") ??
      extractInt(extractTag(extractTag(block, "ClassDescription") ?? "", "Program") ?? "", "Id"),
    ClassDescriptionName: extractTag(extractTag(block, "ClassDescription") ?? "", "Name"),
    ProgramName: extractTag(
      extractTag(extractTag(block, "ClassDescription") ?? "", "Program") ?? "",
      "Name",
    ),
    StaffName: extractTag(extractTag(block, "Staff") ?? "", "Name"),
    StartDateTime: extractTag(block, "StartDateTime") ?? "",
    EndDateTime: extractTag(block, "EndDateTime") ?? "",
    MaxCapacity: extractInt(block, "MaxCapacity"),
    TotalBooked: extractInt(block, "TotalBooked"),
    WebCapacity: extractInt(block, "WebCapacity"),
    WebBooked: extractInt(block, "WebBooked"),
    IsAvailable: extractBool(block, "IsAvailable"),
    IsCanceled: extractBool(block, "IsCanceled"),
  }));

  return { status, errorCode, resultCount, classes };
}

/**
 * Fetch classes via v5 SOAP. Throws MindbodyV5MissingPasswordError if env
 * var not set, MindbodyV5Error on v5 auth failure or non-Success status.
 *
 * Returns ONLY the parsed classes — for raw XML inspection use the
 * `includeRawXml` flag (admin/test page sets it true for debugging).
 */
export async function getClassesV5(
  log: Logger,
  opts: GetClassesV5Opts & { includeRawXml?: boolean },
): Promise<GetClassesV5Response> {
  const cfg = loadV5Config();
  const envelope = buildGetClassesEnvelope(opts, cfg);

  const started = Date.now();
  const res = await fetch(V5_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${V5_NAMESPACE}/GetClasses"`,
    },
    body: envelope,
  });
  const ms = Date.now() - started;
  const xml = await res.text();

  if (!res.ok) {
    log.error("mindbody-v5.getclasses.http-fail", { status: res.status, ms });
    throw new MindbodyV5Error(`v5 GetClasses HTTP ${res.status}`, res.status);
  }

  const parsed = parseGetClassesResponse(xml);
  log.info("mindbody-v5.getclasses.ok", {
    ms,
    status: parsed.status,
    resultCount: parsed.resultCount,
    parsedClasses: parsed.classes.length,
  });
  return opts.includeRawXml ? { ...parsed, rawXml: xml } : parsed;
}
