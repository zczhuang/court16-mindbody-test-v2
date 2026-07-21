import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAdultProgram } from "../config/adult-config.ts";

assert.equal(isAdultProgram("Adult Tennis"), true);
assert.equal(isAdultProgram("Pickleball Intro"), true);
assert.equal(isAdultProgram("Kids Pickleball"), false);
assert.equal(isAdultProgram("Junior Pickleball"), false);
assert.equal(isAdultProgram("Youth Pickleball"), false);
assert.equal(isAdultProgram("Teen Pickleball"), false);
assert.equal(isAdultProgram("Summer Classes"), false);

const chatbot = readFileSync(new URL("../public/chatbot.html", import.meta.url), "utf8");
const bookingStart = chatbot.indexOf("function classDisplayName(c)");
const bookingEnd = chatbot.indexOf("function showEnd", bookingStart);
assert.notEqual(bookingStart, -1, "chatbot calendar helpers and booking flow were not found");
const bookingFlow = chatbot.slice(bookingStart, bookingEnd === -1 ? undefined : bookingEnd);

assert.match(
  bookingFlow,
  /\/api\/mindbody\/calendar\?[^`]+&intent=adult_intro/,
  "chatbot calendar request must declare the adult_intro intent",
);

for (const field of [
  "startDateTime",
  "classScheduleId",
  "classId",
  "name",
  "coach",
  "maxCapacity",
  "totalBooked",
]) {
  assert.match(bookingFlow, new RegExp(`\\bc\\.${field}\\b`), `chatbot must consume DTO field ${field}`);
}

for (const legacyField of [
  "StartDateTime",
  "ClassScheduleId",
  "ClassDescription",
  "MaxCapacity",
  "TotalBooked",
  "Staff",
]) {
  assert.doesNotMatch(
    bookingFlow,
    new RegExp(`\\b${legacyField}\\b`),
    `chatbot must not consume legacy Mindbody field ${legacyField}`,
  );
}

console.log("Calendar consumer intent, DTO, and adult-boundary contracts passed.");
