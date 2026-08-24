import type { TrialClass, TrialRequest } from "../trial-types";

export const TRIAL_E2E_LOCATION_ID = "e2e-sandbox";
export const TRIAL_E2E_LOCATION_NAME = "Automation Test Club";
export const TRIAL_E2E_CLASS_ID = 990062;
export const TRIAL_E2E_CLASS_SCHEDULE_ID = 990061;
export const TRIAL_E2E_CLASS_NAME = "E2E Kids Trial — Ages 7–10";

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: "America/New_York",
});

/** A deterministic-looking future occurrence that never queries a live club calendar. */
export function makeTrialE2EFixtureClass(now = new Date()): TrialClass {
  const fixtureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const date = fixtureDate.toISOString().slice(0, 10);
  const dateAtNoon = new Date(`${date}T12:00:00-04:00`);

  return {
    classScheduleId: TRIAL_E2E_CLASS_SCHEDULE_ID,
    classId: TRIAL_E2E_CLASS_ID,
    name: TRIAL_E2E_CLASS_NAME,
    levelName: "Ages 7–10",
    time: "4:00 PM",
    endTime: "5:00 PM",
    date,
    dayOfWeek: WEEKDAY.format(dateAtNoon),
    coach: "Automation Fixture",
    court: "Test Court",
    spotsAvailable: 8,
    maxCapacity: 8,
    recurrence: "One safe test occurrence",
    startsAt: `${date}T16:00:00`,
  };
}

/** Prefill only synthetic data so a tester never accidentally submits a real family. */
export function makeTrialE2EInitialValues(
  submissionId: string,
  emailDomain: "example.invalid" | "court16-test.invalid" = "example.invalid",
): Partial<TrialRequest> {
  const suffix = submissionId.replaceAll("-", "").slice(0, 10).toLowerCase();
  return {
    parentFirstName: "E2E",
    parentLastName: `Parent-${suffix}`,
    parentEmail: `court16.e2e+${suffix}@${emailDomain}`,
    parentPhone: "2125550199",
    parentBirthDate: "1985-01-01",
    parentGender: "Undisclosed",
    childFirstName: "E2E",
    childLastName: `Player-${suffix}`,
    childBirthDate: "2017-06-15",
    childGender: "Undisclosed",
    householdAddress1: "1 Sandbox Way",
    householdCity: "New York",
    householdState: "NY",
    householdPostalCode: "10001",
    parentEmergencyContactName: "E2E Alternate Contact",
    parentEmergencyContactPhone: "2125550188",
    parentEmergencyContactEmail: `court16.e2e.contact+${suffix}@${emailDomain}`,
    parentEmergencyContactRelationship: "Family friend",
  };
}
