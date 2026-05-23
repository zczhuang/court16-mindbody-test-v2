import type { MindBodyClass, TrialClass } from "./trial-types";
import {
  AGE_TO_LEVEL_MAP,
  CLASS_AGE_METADATA,
  TRIAL_CONFIG,
  ENFORCE_TRIAL_ELIGIBILITY,
} from "@/config/trial-config";

/**
 * Convert a MindBody-style wall-clock ISO ("YYYY-MM-DDTHH:MM:SS", no TZ
 * suffix) to a UTC-Z ISO string ("YYYY-MM-DDTHH:MM:SS.000Z"), treating
 * the input as local time in the supplied IANA timezone.
 *
 * Why: MindBody's `/class/classes` returns `StartDateTime` as the SITE's
 * wall-clock time, no offset. `Date.parse(...)` on a Vercel UTC server
 * silently treats those numbers as UTC — which makes the class look 4h
 * earlier than it actually is in EDT (caught by smoke #2 v2; would have
 * fired the 24h-reminder workflow ~28h before the class instead of 24h).
 *
 * Algorithm:
 *  1. Build `asIfUtc` = Date.UTC(...wallTime parts) — pretend the wall
 *     numbers are UTC.
 *  2. Format `asIfUtc` AS-IF it were a real UTC instant in the target
 *     timezone — get back wall-clock numbers in that TZ.
 *  3. The delta between (1) and (2) is the TZ offset at that instant
 *     (DST-aware via Intl.DateTimeFormat).
 *  4. Shift `asIfUtc` by that offset to get the real UTC instant
 *     corresponding to the original wall time.
 *  5. Re-check the offset at the new instant — if DST changed between
 *     (1) and (4), apply the corrected offset. Usually converges in 1
 *     iteration; matters only for times within ~1h of a DST boundary
 *     (no Court 16 class falls in those windows, but it's free safety).
 *
 * Pure: no I/O, no library dependency. Uses Intl, which Node 16+ ships.
 */
export function siteLocalToUtcIso(localIso: string, timezone: string): string {
  const [datePart, timePartRaw] = localIso.split("T");
  const [yyyy, mm, dd] = datePart.split("-").map(Number);
  const [hh, min, ss] = (timePartRaw ?? "00:00:00").split(":").map(Number);

  const asIfUtc = Date.UTC(yyyy, mm - 1, dd, hh, min, ss);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const offsetMsAt = (instant: number): number => {
    const parts = fmt.formatToParts(new Date(instant));
    const tzed: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") tzed[p.type] = p.value;
    const tzedHour = tzed.hour === "24" ? 0 : Number(tzed.hour);
    const tzedAsIfUtc = Date.UTC(
      Number(tzed.year),
      Number(tzed.month) - 1,
      Number(tzed.day),
      tzedHour,
      Number(tzed.minute),
      Number(tzed.second),
    );
    return instant - tzedAsIfUtc;
  };

  // First pass: use the offset at `asIfUtc` (wall time treated as UTC).
  let result = asIfUtc + offsetMsAt(asIfUtc);
  // Refine: re-check the offset at the corrected instant; if DST flipped
  // between `asIfUtc` and `result` we'll get a different offset and
  // re-shift. One iteration is sufficient for all real-world cases.
  const refinedOffset = offsetMsAt(result);
  if (refinedOffset !== offsetMsAt(asIfUtc)) {
    result = asIfUtc + refinedOffset;
  }
  return new Date(result).toISOString();
}

/**
 * Format a MindBody-style wall-clock ISO ("YYYY-MM-DDTHH:MM:SS", no TZ)
 * into a human-readable "Weekday, Month D at H:MM AM/PM TZ" string in
 * the supplied IANA timezone (e.g. "America/New_York").
 *
 * Example: ("2026-05-27T16:30:00", "America/New_York")
 *       →  "Wednesday, May 27 at 4:30 PM EDT"
 *
 * Used to populate the human-readable `court16_class_day_time` HubSpot
 * Contact property so staff can read the class slot without doing UTC↔
 * local conversion in their head (the canonical Deal `class_date` is
 * stored in UTC ms for workflow correctness; this string is for humans).
 *
 * Returns empty string for unparseable input — caller can fall through.
 */
export function formatClassDayTime(localIso: string, timezone: string): string {
  try {
    // Convert to a real UTC instant first so Intl can format it in TZ.
    const utcIso = siteLocalToUtcIso(localIso, timezone);
    const date = new Date(utcIso);
    if (Number.isNaN(date.getTime())) return "";
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const weekday = get("weekday");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    const dayPeriod = get("dayPeriod");
    const tzName = get("timeZoneName");
    if (!weekday || !month || !day || !hour) return "";
    return `${weekday}, ${month} ${day} at ${hour}:${minute} ${dayPeriod} ${tzName}`;
  } catch {
    return "";
  }
}

/**
 * Parse a MindBody class object into our simplified TrialClass format.
 * Class name lives at `ClassDescription.Name` in MindBody v6; some older
 * proxies surface it as a top-level `ClassName` — accept both.
 */
export function parseClass(mb: MindBodyClass): TrialClass {
  const start = new Date(mb.StartDateTime);
  const end = new Date(mb.EndDateTime);
  const rawName =
    (mb as unknown as { ClassName?: string }).ClassName ||
    mb.ClassDescription?.Name ||
    "Class";
  const levelName = extractLevelName(rawName);

  return {
    classScheduleId: mb.ClassScheduleId,
    classId: mb.Id,
    name: rawName,
    levelName,
    time: formatTime(start),
    endTime: formatTime(end),
    date: formatDateISO(start),
    dayOfWeek: start.toLocaleDateString("en-US", { weekday: "long" }),
    coach: mb.Staff?.DisplayName || "TBD",
    court: mb.Resource?.Name || "",
    // Web-bookable capacity is what AddClientToClass actually accepts.
    // MaxCapacity - TotalBooked includes admin/walk-in bookings; using
    // WebCapacity - WebBooked correctly hides classes that have spots
    // but no online bookings allowed (caught by smoke #3: class 4765
    // showed 2 MaxCapacity spots but WebCapacity=0, MindBody rejected
    // with "Online booking capacity met its threshold").
    // Fall back to MaxCapacity for sites that don't use WebCapacity.
    spotsAvailable:
      typeof (mb as unknown as { WebCapacity?: number }).WebCapacity === "number"
        ? Math.max(
            0,
            ((mb as unknown as { WebCapacity?: number }).WebCapacity ?? 0) -
              ((mb as unknown as { WebBooked?: number }).WebBooked ?? 0),
          )
        : Math.max(0, mb.MaxCapacity - mb.TotalBooked),
    maxCapacity: mb.MaxCapacity,
    recurrence: "",
    startsAt: mb.StartDateTime,
  };
}

export function extractLevelName(className: string): string {
  const levels = [
    "Little Freshman",
    "Freshman",
    "Sophomore",
    "Junior",
    "Senior",
    "Teenager",
  ];
  for (const level of levels) {
    if (className.startsWith(level)) return level;
  }
  return className.split(" I ")[0] || className;
}

export function filterByAge(classes: TrialClass[], age: number): TrialClass[] {
  const ageStr = String(age);
  const allowedLevels = AGE_TO_LEVEL_MAP[ageStr];
  if (!allowedLevels) return [];
  return classes.filter((c) => allowedLevels.some((level) => c.levelName === level));
}

/**
 * Resolve the eligible age range for a class from its level name.
 * Returns null when the level isn't in CLASS_AGE_METADATA — caller
 * should treat this as "no age constraint" (permissive fallback,
 * mirrors ENFORCE_TRIAL_ELIGIBILITY=false).
 */
export function getClassAgeRange(
  cls: Pick<TrialClass, "levelName">,
): { minAge: number; maxAge: number } | null {
  return CLASS_AGE_METADATA[cls.levelName] ?? null;
}

export function filterByTrialEligibility(
  classes: TrialClass[],
  locationId: string,
): TrialClass[] {
  if (!ENFORCE_TRIAL_ELIGIBILITY) return classes;
  const config = TRIAL_CONFIG[locationId];
  if (!config) return [];
  return classes.filter((c) => config.trialEligibleClassScheduleIds.includes(c.classScheduleId));
}

export function filterChildrenOnly(classes: MindBodyClass[]): MindBodyClass[] {
  // Drop cancelled classes only. Age filtering in the orchestrator handles
  // narrowing to trial-eligible children's classes once we have real
  // Court 16 data with level-prefixed ClassNames. Real-data sites will
  // still look correct because their non-children's programs use distinct
  // ClassDescription.Name values that don't match the level filter.
  return classes.filter((c) => !c.IsCanceled);
}

/**
 * Filter to adult classes only — mirrors filterChildrenOnly. Real Court 16
 * data will expose adult programs via ClassDescription.Program.Name (e.g.
 * "Adult Tennis", "Pickleball"). In sandbox / early-dev data the program
 * names are arbitrary, so we fall back to "not a children's program" which
 * catches anything that isn't clearly a kids class.
 */
export function filterAdultOnly(classes: MindBodyClass[]): MindBodyClass[] {
  return classes.filter((c) => {
    if (c.IsCanceled) return false;
    const name = c.ClassDescription?.Program?.Name;
    const className = c.ClassDescription?.Name || "";
    // Explicit adult match
    if (name && /adult|pickleball|intro/i.test(name)) return true;
    // Explicit children match -> exclude
    if (name && /children|kids|freshman|sophomore|junior|little/i.test(name)) return false;
    if (/little freshman|freshman|sophomore|junior|teenager/i.test(className)) return false;
    // Unknown program — include (dev safety net, same as children helper)
    return true;
  });
}

export function filterAvailable(classes: TrialClass[]): TrialClass[] {
  return classes.filter((c) => c.spotsAvailable > 0);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function getLevelColor(levelName: string): string {
  const colors: Record<string, string> = {
    "Little Freshman": "#E8F5E9",
    Freshman: "#FFF9C4",
    Sophomore: "#FFE0B2",
    Junior: "#FFCDD2",
    Senior: "#E1BEE7",
    Teenager: "#B3E5FC",
  };
  return colors[levelName] || "#E0E0E0";
}
