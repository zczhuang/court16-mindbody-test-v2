import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  maxCalendarDateStr,
  TRIAL_CALENDAR_DISPLAY_DAYS,
} from "../config/trial-config.ts";
import {
  getTrialBookingWindowState,
  isValidMindbodyClassStart,
  trialBookingWindowMessage,
  TRIAL_BOOKING_WINDOW_DAYS,
  TRIAL_MIN_BOOKING_NOTICE_HOURS,
} from "../lib/trial-booking-window.ts";

assert.equal(TRIAL_CALENDAR_DISPLAY_DAYS, 28);
assert.equal(TRIAL_BOOKING_WINDOW_DAYS, 7);
assert.equal(TRIAL_MIN_BOOKING_NOTICE_HOURS, 48);

// Exactly 28 site-local calendar dates, including today.
assert.equal(
  maxCalendarDateStr("America/New_York", new Date("2026-07-31T16:00:00Z")),
  "2026-08-27",
);
assert.equal(
  maxCalendarDateStr("America/New_York", new Date("2026-12-20T17:00:00Z")),
  "2027-01-16",
);
// Midnight rollover follows the club, not the browser/server timezone.
assert.equal(
  maxCalendarDateStr("America/New_York", new Date("2026-08-01T03:59:59Z")),
  "2026-08-27",
);
assert.equal(
  maxCalendarDateStr("America/New_York", new Date("2026-08-01T04:00:00Z")),
  "2026-08-28",
);

assert.equal(isValidMindbodyClassStart("2026-08-07T12:00:00"), true);
assert.equal(isValidMindbodyClassStart("2026-02-29T12:00:00"), false);
assert.equal(isValidMindbodyClassStart("2028-02-29T12:00:00"), true);
assert.equal(isValidMindbodyClassStart("2026-13-01T12:00:00"), false);
assert.equal(isValidMindbodyClassStart("not-a-date"), false);

const classStart = "2026-08-07T16:00:00.000Z";
assert.equal(
  getTrialBookingWindowState(classStart, Date.parse("2026-07-31T15:59:59.999Z")).status,
  "not_open",
);
assert.equal(
  getTrialBookingWindowState(classStart, Date.parse("2026-07-31T16:00:00.000Z")).status,
  "open",
  "booking opens exactly seven days before class",
);
assert.equal(
  getTrialBookingWindowState(classStart, Date.parse("2026-08-05T16:00:00.000Z")).status,
  "open",
  "exactly 48 hours of notice is allowed",
);
assert.equal(
  getTrialBookingWindowState(classStart, Date.parse("2026-08-05T16:00:00.001Z")).status,
  "closed",
);
assert.equal(
  getTrialBookingWindowState(classStart, Date.parse("2026-08-07T16:00:00.000Z")).status,
  "closed",
);
assert.equal(getTrialBookingWindowState("invalid", Date.now()).status, "invalid");
assert.equal(
  trialBookingWindowMessage(
    getTrialBookingWindowState(classStart, Date.parse("2026-08-05T16:00:00.001Z")),
    "America/New_York",
  ),
  "Booking closed — 48-hour notice required",
);

// Absolute-hour cutoffs stay correct across Eastern DST changes. These UTC
// starts correspond to 10:00 AM New York time on the transition dates.
assert.equal(
  getTrialBookingWindowState(
    "2026-03-08T14:00:00.000Z",
    Date.parse("2026-03-06T14:00:00.000Z"),
  ).status,
  "open",
);
assert.equal(
  getTrialBookingWindowState(
    "2026-03-08T14:00:00.000Z",
    Date.parse("2026-03-06T14:00:00.001Z"),
  ).status,
  "closed",
);
assert.equal(
  getTrialBookingWindowState(
    "2026-11-01T15:00:00.000Z",
    Date.parse("2026-10-30T15:00:00.000Z"),
  ).status,
  "open",
);
assert.equal(
  getTrialBookingWindowState(
    "2026-11-01T15:00:00.000Z",
    Date.parse("2026-10-30T15:00:00.001Z"),
  ).status,
  "closed",
);

const trialPage = readFileSync(new URL("../app/trial/page.tsx", import.meta.url), "utf8");
const calendarRoute = readFileSync(
  new URL("../app/api/mindbody/calendar/route.ts", import.meta.url),
  "utf8",
);
const bookingRoute = readFileSync(
  new URL("../app/api/book/trial/route.ts", import.meta.url),
  "utf8",
);
const classCard = readFileSync(
  new URL("../components/ClassCard.tsx", import.meta.url),
  "utf8",
);
const bookingWindow = readFileSync(
  new URL("../lib/trial-booking-window.ts", import.meta.url),
  "utf8",
);

assert.match(trialPage, /const endDate = maxCalendarDateStr\(loc\.timezone\)/);
assert.match(trialPage, /maxVisibleDateStr=\{maxCalendarDateStr\(location\.timezone\)\}/);
assert.doesNotMatch(trialPage, /maxBookableDateStr|TRIAL_MAX_ADVANCE_DAYS/);
assert.match(calendarRoute, /const maxDate = maxCalendarDateStr\(loc\.timezone\)/);

const earlyWindowGuard = bookingRoute.indexOf("const requestedWindowFailure");
const rateLimit = bookingRoute.indexOf("const rateLimit = consumeSignupRateLimit");
const lock = bookingRoute.indexOf("signupLock = await acquireDistributedActionLock");
const liveRead = bookingRoute.indexOf('path: "/class/classes"');
const canonicalWindowGuard = bookingRoute.indexOf("const canonicalWindowFailure");
assert(earlyWindowGuard >= 0 && earlyWindowGuard < rateLimit);
assert(rateLimit < lock);
assert(liveRead >= 0 && canonicalWindowGuard > liveRead);
assert.match(bookingRoute, /code: "trial_booking_not_open"/);
assert.match(bookingRoute, /code: "trial_booking_closed"/);
assert.doesNotMatch(bookingRoute, /TRIAL_MAX_ADVANCE_DAYS|maxBookableDateStr/);

// Preview-only cards remain traversable for design review, but a future live
// launch cannot open the form outside the approved booking window.
assert.match(classCard, /if \(interaction\.kind === "preview"\)[\s\S]*?onClick=\{\(\) => interaction\.onSelect/);
assert.match(classCard, /disabled=\{liveBookingLocked\}/);
assert.match(classCard, /trialBookingWindowMessage/);
assert.match(bookingWindow, /Booking opens/);

console.log("Trial display and booking-window contracts passed.");
