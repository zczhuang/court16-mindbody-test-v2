import type { CalendarClassDto, MindBodyClass, TrialClass } from "./trial-types";
import { TRIAL_CONFIG, ENFORCE_TRIAL_ELIGIBILITY } from "@/config/trial-config";
import { getCourt16KidsLevelAgeRange } from "./kids-calendar";

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
 * Whole-year age as of today for an ISO "YYYY-MM-DD" birth date.
 * Returns NaN for unparseable input.
 */
export function ageFromDob(dobIso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) return NaN;
  const [y, m, d] = dobIso.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

/**
 * Parse a MindBody class object into our simplified TrialClass format.
 * Class name lives at `ClassDescription.Name` in MindBody v6; some older
 * proxies surface it as a top-level `ClassName` — accept both.
 */
export function parseClass(mb: CalendarClassDto): TrialClass {
  const start = new Date(mb.startDateTime);
  const end = new Date(mb.endDateTime);
  const rawName = mb.name || "Class";
  const levelName = extractLevelName(rawName);

  return {
    classScheduleId: mb.classScheduleId,
    classId: mb.classId,
    name: rawName,
    levelName,
    time: formatTime(start),
    endTime: formatTime(end),
    date: formatDateISO(start),
    dayOfWeek: start.toLocaleDateString("en-US", { weekday: "long" }),
    coach: mb.coach || "TBD",
    court: mb.court || "",
    // Web-bookable capacity is what AddClientToClass actually accepts.
    // MaxCapacity - TotalBooked includes admin/walk-in bookings; using
    // WebCapacity - WebBooked correctly hides classes that have spots
    // but no online bookings allowed (caught by smoke #3: class 4765
    // showed 2 MaxCapacity spots but WebCapacity=0, MindBody rejected
    // with "Online booking capacity met its threshold").
    // Fall back to MaxCapacity for sites that don't use WebCapacity.
    spotsAvailable:
      typeof mb.webCapacity === "number"
        ? Math.max(
            0,
            (mb.webCapacity ?? 0) - (mb.webBooked ?? 0),
          )
        : Math.max(0, mb.maxCapacity - mb.totalBooked),
    maxCapacity: mb.maxCapacity,
    recurrence: "",
    startsAt: mb.startDateTime,
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

/**
 * Parse the integer age range from a Court 16 class title.
 *
 * Court 16's titles encode the true eligible age range explicitly:
 *   "Little Freshman 2.5 - 3.9yo"  → { ageMin: 3, ageMax: 3 }
 *   "Freshman/Sophomore 4 - 6.9yo" → { ageMin: 4, ageMax: 6 }
 *   "Junior/Senior 7 - 12.9yo"     → { ageMin: 7, ageMax: 12 }
 *   "Teenager 13 +"                → { ageMin: 13, ageMax: 99 }
 *
 * Decimal bounds are ceil/floored to integers since the calendar
 * dropdown collects integer ages 3–17. Returns null when no parseable
 * range is found. When a regular schedule title omits numbers, the known
 * Court 16 level family supplies a broad band (Freshman/Sophomore 4–6,
 * Junior/Senior 7–12). Unknown titles remain permissive.
 *
 * Replaces the older level-name → CLASS_AGE_METADATA pipeline, which
 * mis-classified combo titles ("Freshman/Sophomore", "Junior/Senior")
 * by only their first level prefix and dropped ages 7–9 entirely.
 */
export function parseAgeRangeFromTitle(
  title: string,
): { ageMin: number; ageMax: number } | null {
  // Range form: "X - Y[yo]" where X/Y can be decimals, with hyphen or en-dash.
  const range = title.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*yo/i);
  if (range) {
    return {
      ageMin: Math.ceil(Number(range[1])),
      ageMax: Math.floor(Number(range[2])),
    };
  }
  // Open-ended upper: "N +" or "N+" (e.g. "Teenager 13 +").
  const open = title.match(/(\d+)\s*\+/);
  if (open) {
    return { ageMin: Number(open[1]), ageMax: 99 };
  }
  return getCourt16KidsLevelAgeRange(title);
}

export function filterByAge(classes: TrialClass[], age: number): TrialClass[] {
  return classes.filter((c) => {
    const range = parseAgeRangeFromTitle(c.name);
    if (!range) return true; // permissive when the title doesn't encode a range
    return age >= range.ageMin && age <= range.ageMax;
  });
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
