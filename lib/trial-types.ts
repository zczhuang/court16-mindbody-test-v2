import type { MindbodyProfileDetails } from "./trial-intake";
import type { TrialReportingDetails } from "./trial-reporting";

/** MindBody class object — subset of fields we use from the API response */
export interface MindBodyClass {
  ClassScheduleId: number;
  Id: number;
  ClassName: string;
  StartDateTime: string;
  EndDateTime: string;
  MaxCapacity: number;
  TotalBooked: number;
  WebCapacity?: number;
  WebBooked?: number;
  IsCanceled: boolean;
  IsAvailable: boolean;
  Staff: {
    DisplayName: string;
    FirstName: string;
    LastName: string;
  };
  Resource: {
    Id: number;
    Name: string;
  };
  ClassDescription: {
    Id: number;
    Name: string;
    Program: {
      Id: number;
      Name: string;
      ScheduleType: string;
    };
    SessionType: {
      Name: string;
    };
  };
  Location: {
    Id: number;
    Name: string;
    SiteID: number;
  };
}

/** Narrow parent-facing calendar payload projected from a Mindbody class. */
export interface CalendarClassDto {
  classScheduleId: number;
  classId: number;
  name: string;
  startDateTime: string;
  endDateTime: string;
  maxCapacity: number;
  totalBooked: number;
  webCapacity?: number;
  webBooked?: number;
  coach: string;
  court: string;
}

/** Parsed class card data for the trial calendar UI */
export interface TrialClass {
  classScheduleId: number;
  classId: number;
  name: string;
  levelName: string;
  time: string;
  endTime: string;
  date: string;
  dayOfWeek: string;
  coach: string;
  court: string;
  spotsAvailable: number;
  maxCapacity: number;
  recurrence: string;
  /**
   * ISO 8601 start datetime, passed through verbatim from MindBody's
   * `StartDateTime`. Threaded into the request body so the booking app
   * can set HubSpot Deal `class_date` for workflow 3 (24h reminder).
   */
  startsAt: string;
}

/** A single child in a trial request */
export interface ChildInfo {
  firstName: string;
  /** Required by the API (Ibtissam review Jun 11): real MindBody profile needs it. */
  lastName: string;
  age: number;
  /** ISO "YYYY-MM-DD". Required by the API; age is derived server-side. */
  birthDate: string;
}

/** Parent-facing outcome returned by POST /api/book/trial. */
export type TrialSubmissionStatus =
  | "pending_staff"
  | "manual_review"
  | "duplicate_email_softwall";

/** Trial request form submission */
export interface TrialRequest extends MindbodyProfileDetails, TrialReportingDetails {
  /**
   * Browser-generated UUID for one logical form submission. The client reuses
   * it across network retries so the server can make booking writes idempotent.
   */
  submissionId: string;
  parentFirstName: string;
  /** Required — needed for MindBody client record + downstream comms. */
  parentLastName: string;
  parentEmail: string;
  /** Required — staff calls within hours to confirm the trial. */
  parentPhone: string;
  /** Required (Ibtissam review Jun 11) — real DOB on the MindBody parent
   * record, no more placeholder fallback. ISO "YYYY-MM-DD". */
  parentBirthDate: string;
  childFirstName: string;
  /** Required by the API — MindBody child profile needs the real last name. */
  childLastName?: string;
  childAge: number;
  /** ISO "YYYY-MM-DD". Required by the API; childAge is derived from it. */
  childBirthDate?: string;
  children: ChildInfo[];
  locationId: string;
  locationName: string;
  classScheduleId: number;
  /**
   * Per-occurrence ClassId (MindBody's `Class.Id`, distinct from
   * ClassScheduleId which is the recurring schedule template). REQUIRED
   * by AddClientToClass on confirm — caught by smoke #3 v1 (Bug E:
   * passing ClassScheduleId returned 502 from MindBody). Forms must
   * thread `trialClass.classId` here, not classScheduleId.
   */
  classId: number;
  className: string;
  classDay: string;
  classTime: string;
  /** ISO 8601 start datetime (e.g. 2026-05-15T19:00:00). Drives HubSpot Deal `class_date`. */
  classStartsAt?: string;
  coachName: string;
  notes?: string;
  /**
   * HubSpot attribution context captured client-side (Ibtissam review
   * item 6 — without pageUri the Contact's "form inquiry" activity links
   * to the legacy website form's page). hutk is the visitor's hubspotutk
   * cookie when present; server validates the format before forwarding.
   */
  hsContext?: { hutk?: string; pageUri?: string; pageName?: string };
}
