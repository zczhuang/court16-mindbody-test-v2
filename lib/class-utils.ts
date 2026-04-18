import type { MindBodyClass, TrialClass } from "./trial-types";
import {
  AGE_TO_LEVEL_MAP,
  TRIAL_CONFIG,
  ENFORCE_TRIAL_ELIGIBILITY,
} from "@/config/trial-config";

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
    spotsAvailable: Math.max(0, mb.MaxCapacity - mb.TotalBooked),
    maxCapacity: mb.MaxCapacity,
    recurrence: "",
  };
}

function extractLevelName(className: string): string {
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
