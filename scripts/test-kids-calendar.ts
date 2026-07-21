import assert from "node:assert/strict";
import {
  filterConfiguredKidsSchedule,
  getCourt16KidsLevelAgeRange,
} from "../lib/kids-calendar.ts";
import { toCalendarClassDto } from "../lib/calendar-dto.ts";
import { isAdultProgram } from "../config/adult-config.ts";
import type { MindBodyClass } from "../lib/trial-types.ts";

function makeClass(input: {
  id: number;
  programId: number;
  programName: string;
  className: string;
  cancelled?: boolean;
}): MindBodyClass {
  return {
    ClassScheduleId: input.id * 10,
    Id: input.id,
    ClassName: input.className,
    StartDateTime: "2026-07-21T10:00:00",
    EndDateTime: "2026-07-21T11:00:00",
    MaxCapacity: 6,
    TotalBooked: 0,
    WebCapacity: 0,
    WebBooked: 0,
    IsCanceled: input.cancelled ?? false,
    IsAvailable: true,
    Staff: { DisplayName: "Coach", FirstName: "Test", LastName: "Coach" },
    Resource: { Id: 1, Name: "Court 1" },
    ClassDescription: {
      Id: input.id * 100,
      Name: input.className,
      Program: {
        Id: input.programId,
        Name: input.programName,
        ScheduleType: "Class",
      },
      SessionType: { Name: "Class" },
    },
    Location: { Id: 1, Name: "Test Club", SiteID: 12345 },
  };
}

const rows = [
  makeClass({ id: 1, programId: 76, programName: "Kids Summer Classes", className: "Kids Sound of Tennis" }),
  makeClass({ id: 2, programId: 29, programName: "Summer Classes", className: "Little Freshman 2.5 - 3.9yo" }),
  makeClass({ id: 3, programId: 29, programName: "Summer Classes", className: "Freshman/Sophomore 4 - 6.9yo" }),
  makeClass({ id: 4, programId: 29, programName: "Summer Classes", className: "Adult Intro" }),
  makeClass({ id: 5, programId: 99, programName: "Kids Classes", className: "Junior 7 - 12.9yo" }),
  makeClass({ id: 6, programId: 76, programName: "Kids Summer Classes", className: "Senior 10 - 12.9yo", cancelled: true }),
];

const filtered = filterConfiguredKidsSchedule(rows, [76, 29]);
assert.deepEqual(
  filtered.map((row) => row.Id),
  [1, 2, 3],
);
assert.deepEqual(getCourt16KidsLevelAgeRange("Little Freshman I 30 Min Class"), {
  ageMin: 3,
  ageMax: 3,
});
assert.deepEqual(getCourt16KidsLevelAgeRange("Freshman/Sophomore 45 Minutes"), {
  ageMin: 4,
  ageMax: 6,
});
assert.deepEqual(getCourt16KidsLevelAgeRange("Junior Intermediate"), {
  ageMin: 7,
  ageMax: 12,
});
assert.deepEqual(getCourt16KidsLevelAgeRange("Teenager Int."), {
  ageMin: 13,
  ageMax: 17,
});
assert.equal(getCourt16KidsLevelAgeRange("Adult Intro"), null);
assert.equal(isAdultProgram("Adult Tennis"), true);
assert.equal(isAdultProgram("Pickleball Intro"), true);
assert.equal(isAdultProgram("Kids Pickleball"), false);
assert.equal(isAdultProgram("Junior Pickleball"), false);
assert.equal(isAdultProgram("Youth Pickleball"), false);
assert.equal(isAdultProgram("Teen Pickleball"), false);
assert.equal(isAdultProgram("Summer Classes"), false);

const rawClass = makeClass({
  id: 7,
  programId: 76,
  programName: "Kids Summer Classes",
  className: "Junior 7 - 12.9yo",
});
const rawWithPrivateFields = rawClass as MindBodyClass & {
  internalNote: string;
  Staff: MindBodyClass["Staff"] & { Email: string };
};
rawWithPrivateFields.internalNote = "never publish";
rawWithPrivateFields.Staff.Email = "coach@example.com";
assert.deepEqual(toCalendarClassDto(rawWithPrivateFields), {
  classScheduleId: 70,
  classId: 7,
  name: "Junior 7 - 12.9yo",
  startDateTime: "2026-07-21T10:00:00",
  endDateTime: "2026-07-21T11:00:00",
  maxCapacity: 6,
  totalBooked: 0,
  webCapacity: 0,
  webBooked: 0,
  coach: "Coach",
  court: "Court 1",
});

console.log("Kids calendar allowlist and taxonomy filter passed.");
