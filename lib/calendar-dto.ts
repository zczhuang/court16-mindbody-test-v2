import type { CalendarClassDto, MindBodyClass } from "./trial-types";

/** Publish only the fields the parent-facing calendar renders. */
export function toCalendarClassDto(input: MindBodyClass): CalendarClassDto {
  return {
    classScheduleId: input.ClassScheduleId,
    classId: input.Id,
    name: input.ClassName || input.ClassDescription?.Name || "Class",
    startDateTime: input.StartDateTime,
    endDateTime: input.EndDateTime,
    maxCapacity: input.MaxCapacity,
    totalBooked: input.TotalBooked,
    ...(typeof input.WebCapacity === "number" ? { webCapacity: input.WebCapacity } : {}),
    ...(typeof input.WebBooked === "number" ? { webBooked: input.WebBooked } : {}),
    coach: input.Staff?.DisplayName || "TBD",
    court: input.Resource?.Name || "",
  };
}
