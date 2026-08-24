import assert from "node:assert/strict";
import type { MindBodyClass } from "../lib/trial-types";

const moduleUrl = new URL("../lib/staff-reassign.ts", import.meta.url).href;
const { encodeSlotValue, parseSlotValue, selectReassignSlots, siteLocalNowIso } = (await import(
  moduleUrl
)) as typeof import("../lib/staff-reassign");

const PROGRAM_ID = 120;
const SITE_ID = 5748154;
const NOW = "2026-08-07T09:00:00";

function makeClass(overrides: Partial<MindBodyClass> = {}): MindBodyClass {
  return {
    Id: 9001,
    ClassScheduleId: 4001,
    ClassName: "Freshman/Sophomore 4 - 6.9yo",
    StartDateTime: "2026-08-08T10:00:00",
    EndDateTime: "2026-08-08T11:00:00",
    MaxCapacity: 8,
    TotalBooked: 2,
    IsCanceled: false,
    IsAvailable: true,
    Staff: { DisplayName: "Coach Ana", FirstName: "Ana", LastName: "Diaz" },
    Resource: { Id: 1, Name: "Court 1" },
    ClassDescription: {
      Id: 77,
      Name: "Freshman/Sophomore 4 - 6.9yo",
      Program: { Id: PROGRAM_ID, Name: "Kids Trial", ScheduleType: "Class" },
      SessionType: { Name: "Trial" },
    },
    Location: { Id: 3, Name: "Newton", SiteID: SITE_ID },
    ...overrides,
  } as MindBodyClass;
}

const criteria = {
  programId: PROGRAM_ID,
  siteId: SITE_ID,
  currentClassId: 9000,
  nowSiteLocal: NOW,
};

// A clean, bookable occurrence survives and carries its Mindbody-owned metadata.
const kept = selectReassignSlots([makeClass()], criteria);
assert.equal(kept.length, 1);
assert.deepEqual(kept[0], {
  classId: 9001,
  classScheduleId: 4001,
  startDateTime: "2026-08-08T10:00:00",
  className: "Freshman/Sophomore 4 - 6.9yo",
  coachName: "Coach Ana",
  spotsRemaining: 6,
});

// Every rejection below would otherwise produce a picker option that fails at
// the moment staff clicks it. These are the same facts intake re-verifies.
const rejected: Array<[string, MindBodyClass]> = [
  ["the class the request is already on", makeClass({ Id: 9000 })],
  ["a different program", makeClass({
    ClassDescription: { ...makeClass().ClassDescription, Program: { Id: 61, Name: "Other", ScheduleType: "Class" } },
  })],
  ["a different site", makeClass({ Location: { Id: 3, Name: "Newton", SiteID: 99 } })],
  ["cancelled", makeClass({ IsCanceled: true })],
  ["not bookable", makeClass({ IsAvailable: false })],
  ["already full", makeClass({ MaxCapacity: 8, TotalBooked: 8 })],
  ["web-capacity full even with room in the room", makeClass({ WebCapacity: 2, WebBooked: 2 })],
  ["in the past", makeClass({ StartDateTime: "2026-08-07T08:00:00" })],
  ["starting exactly now", makeClass({ StartDateTime: NOW })],
  ["a non-positive class id", makeClass({ Id: 0 })],
  ["a non-positive schedule id", makeClass({ ClassScheduleId: -1 })],
];
for (const [label, candidate] of rejected) {
  assert.equal(selectReassignSlots([candidate], criteria).length, 0, `must reject ${label}`);
}

// WebCapacity wins over room capacity when the site publishes it: a class can
// have physical spots while online booking is closed.
const webLimited = selectReassignSlots(
  [makeClass({ MaxCapacity: 8, TotalBooked: 0, WebCapacity: 4, WebBooked: 3 })],
  criteria,
);
assert.equal(webLimited[0]?.spotsRemaining, 1);

// Staff read a chronological list, whatever order Mindbody paged them in.
const ordered = selectReassignSlots(
  [
    makeClass({ Id: 3, StartDateTime: "2026-08-10T10:00:00" }),
    makeClass({ Id: 1, StartDateTime: "2026-08-08T10:00:00" }),
    makeClass({ Id: 2, StartDateTime: "2026-08-09T10:00:00" }),
  ],
  criteria,
);
assert.deepEqual(ordered.map((slot) => slot.classId), [1, 2, 3]);

// Coach falls back to the name parts, then to empty rather than "undefined".
assert.equal(
  selectReassignSlots(
    [makeClass({ Staff: { DisplayName: "", FirstName: "Sam", LastName: "Lee" } })],
    criteria,
  )[0]?.coachName,
  "Sam Lee",
);
assert.equal(
  selectReassignSlots(
    [makeClass({ Staff: { DisplayName: "", FirstName: "", LastName: "" } })],
    criteria,
  )[0]?.coachName,
  "",
);

// With no current class on the ledger, nothing is excluded on that basis.
assert.equal(
  selectReassignSlots([makeClass()], { ...criteria, currentClassId: undefined }).length,
  1,
);

// Round-trip: what the form posts is exactly what parses back.
const slot = { classId: 9001, classScheduleId: 4001 };
const encoded = encodeSlotValue(slot);
assert.equal(encoded, "9001:4001");
assert.deepEqual(parseSlotValue(encoded), { ok: true, ...slot });

// A missing selection is distinguishable from a malformed one, because staff
// get different instructions for each.
assert.deepEqual(parseSlotValue(null), { ok: false, reason: "missing" });
assert.deepEqual(parseSlotValue(""), { ok: false, reason: "missing" });
assert.deepEqual(parseSlotValue("   "), { ok: false, reason: "missing" });
for (const malformed of ["9001", "9001:4001:1", "abc:4001", "9001:abc", "0:4001", "9001:0", "-1:4001", "9001.5:4001"]) {
  assert.deepEqual(
    parseSlotValue(malformed),
    { ok: false, reason: "malformed" },
    `must reject ${malformed}`,
  );
}
assert.deepEqual(parseSlotValue(9001), { ok: false, reason: "missing" });
assert.deepEqual(parseSlotValue(undefined), { ok: false, reason: "missing" });

// Site-local "now" must match Mindbody's StartDateTime shape exactly, or the
// lexicographic past/future compare in selectReassignSlots is meaningless.
const noon = new Date("2026-08-07T16:30:00Z");
assert.equal(siteLocalNowIso("America/New_York", noon), "2026-08-07T12:30:00");
assert.equal(siteLocalNowIso("UTC", noon), "2026-08-07T16:30:00");
assert.match(siteLocalNowIso("America/New_York"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
// Midnight is the case where a 24-hour formatter can emit "24" and sort wrong.
assert.equal(
  siteLocalNowIso("America/New_York", new Date("2026-08-07T04:00:00Z")),
  "2026-08-07T00:00:00",
);

console.log("Staff reassign slot selection passed.");
