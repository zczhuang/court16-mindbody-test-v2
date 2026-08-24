import type { MindBodyClass } from "@/lib/trial-types";

/**
 * Pure slot-selection and form-parsing logic for staff reassign.
 *
 * Kept out of the route so the eligibility rules — which decide where a real
 * child gets moved — are unit-testable without HubSpot or Mindbody.
 */

export interface ReassignSlot {
  classId: number;
  classScheduleId: number;
  /** Mindbody site-local wall clock, no timezone suffix. */
  startDateTime: string;
  className: string;
  coachName: string;
  spotsRemaining: number;
}

export interface ReassignSlotCriteria {
  /** Only this club's dedicated trial Program is offerable. */
  programId: number;
  siteId: number;
  /** The occurrence the request is currently on; never offer it back. */
  currentClassId?: number;
  /** Site-local wall clock; occurrences at or before this are past. */
  nowSiteLocal: string;
}

/**
 * Narrow a raw Mindbody class pull down to slots staff may move a child into.
 *
 * These are the same facts intake re-verifies before it books
 * (`app/api/book/trial/route.ts`): right program, right site, live, bookable,
 * and with a spot free. Offering anything else would produce a picker whose
 * options fail at the moment staff clicks.
 */
export function selectReassignSlots(
  classes: MindBodyClass[],
  criteria: ReassignSlotCriteria,
): ReassignSlot[] {
  const slots: ReassignSlot[] = [];
  for (const candidate of classes) {
    const classId = Number(candidate.Id);
    const classScheduleId = Number(candidate.ClassScheduleId);
    if (!Number.isInteger(classId) || classId <= 0) continue;
    if (!Number.isInteger(classScheduleId) || classScheduleId <= 0) continue;
    if (classId === criteria.currentClassId) continue;
    if (Number(candidate.ClassDescription?.Program?.Id) !== criteria.programId) continue;
    if (Number(candidate.Location?.SiteID) !== criteria.siteId) continue;
    if (candidate.IsCanceled || !candidate.IsAvailable) continue;

    const startDateTime = candidate.StartDateTime;
    if (typeof startDateTime !== "string" || startDateTime.length === 0) continue;
    // Both sides are Mindbody site-local wall clock in the same ISO shape, so a
    // lexicographic compare is a correct chronological compare and needs no
    // timezone maths.
    if (startDateTime <= criteria.nowSiteLocal) continue;

    const spotsRemaining =
      typeof candidate.WebCapacity === "number"
        ? Number(candidate.WebCapacity) - Number(candidate.WebBooked ?? 0)
        : Number(candidate.MaxCapacity) - Number(candidate.TotalBooked);
    if (!(spotsRemaining > 0)) continue;

    slots.push({
      classId,
      classScheduleId,
      startDateTime,
      className: candidate.ClassDescription?.Name || candidate.ClassName || "Trial class",
      coachName:
        candidate.Staff?.DisplayName ||
        [candidate.Staff?.FirstName, candidate.Staff?.LastName].filter(Boolean).join(" ") ||
        "",
      spotsRemaining,
    });
  }
  slots.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  return slots;
}

/**
 * "Now" as club wall-clock in Mindbody's `StartDateTime` shape
 * ("YYYY-MM-DDTHH:mm:ss"), so occurrence times can be compared without
 * converting either side. The sv-SE locale formats as "YYYY-MM-DD HH:mm:ss".
 */
export function siteLocalNowIso(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(" ", "T");
}

/** Round-trip a slot through the HTML form as one opaque, re-validated value. */
export function encodeSlotValue(slot: Pick<ReassignSlot, "classId" | "classScheduleId">): string {
  return `${slot.classId}:${slot.classScheduleId}`;
}

export type ParsedSlotSelection =
  | { ok: true; classId: number; classScheduleId: number }
  | { ok: false; reason: "missing" | "malformed" };

/**
 * Parse the posted slot. The value is only ever a lookup key: the route still
 * re-reads the occurrence from Mindbody, so a forged pair selects nothing.
 */
export function parseSlotValue(raw: unknown): ParsedSlotSelection {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: "missing" };
  const parts = raw.trim().split(":");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const classId = Number(parts[0]);
  const classScheduleId = Number(parts[1]);
  if (!Number.isInteger(classId) || classId <= 0) return { ok: false, reason: "malformed" };
  if (!Number.isInteger(classScheduleId) || classScheduleId <= 0) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, classId, classScheduleId };
}
