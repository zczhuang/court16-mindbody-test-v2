import crypto from "node:crypto";
import {
  addClient,
  addClientToClass,
  authedMindbodyGet,
  checkoutTrialBooking,
  getClientServices,
  getClientVisits,
  getClientsByEmail,
  getClientsByIds,
  isAlreadyBookedError,
  loadConfigFromEnv,
  PARENT_GUARDIAN_RELATIONSHIP,
  type ClientService,
  type ClientVisit,
  type MindbodyClient,
} from "../mindbody";
import { findExactActiveClientVisit } from "../mindbody-booking-evidence";
import { createLogger } from "../logger";
import type { MindBodyClass, TrialClass, TrialRequest } from "../trial-types";
import { normalizeMindbodyProfileDetails } from "../trial-intake";
import {
  TrialE2EReceiptError,
  TrialE2EValidationError,
  signTrialE2EReceipt,
  validateTrialE2ERequest,
  verifyTrialE2EReceipt,
} from "./core";
import { TRIAL_E2E_LOCATION_ID } from "./fixtures";
import type {
  TrialE2EReceipt,
  TrialE2ERunResponse,
  TrialE2EStage,
  TrialE2EStageSystem,
} from "./types";
import { assertTrialE2ELedgerContract } from "./ledger-contract";
import {
  deriveTrialE2ERunId,
  journalPhaseIsAtLeastFamilyVerified,
  type TrialE2EJournalController,
} from "./journal";

const SANDBOX_SITE_ID = "-99";
const SANDBOX_SITE_ID_NUMBER = -99;
const SANDBOX_TIMEZONE = "America/Chicago";
const SANDBOX_LOCATION_ID = 1;
const SANDBOX_PROGRAM_ID = 26;
const SANDBOX_CLASS_SCHEDULE_ID = 2180;
const SANDBOX_SERVICE_ID = 1377;
const SANDBOX_SERVICE_NAME = "Groupon 5 Class Intro Series";
const SANDBOX_CLASS_NAME = "TRX Small Group";
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

export class TrialE2EReconciliationRequiredError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "TrialE2EReconciliationRequiredError";
    this.retryable = retryable;
  }
}

function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateTimeInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function wallClockLabel(value: string): string {
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${hour24 >= 12 ? "PM" : "AM"}`;
}

function mapSandboxClass(raw: MindBodyClass): TrialClass {
  const date = raw.StartDateTime.slice(0, 10);
  const dateAtNoon = new Date(`${date}T12:00:00-05:00`);
  const capacity = Number(raw.WebCapacity ?? raw.MaxCapacity ?? 0);
  const booked = Number(raw.WebBooked ?? raw.TotalBooked ?? 0);
  return {
    classScheduleId: Number(raw.ClassScheduleId),
    classId: Number(raw.Id),
    name: raw.ClassDescription?.Name || raw.ClassName || SANDBOX_CLASS_NAME,
    levelName: "Site -99 · Program 26",
    time: wallClockLabel(raw.StartDateTime),
    endTime: wallClockLabel(raw.EndDateTime),
    date,
    dayOfWeek: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: SANDBOX_TIMEZONE,
    }).format(dateAtNoon),
    coach:
      raw.Staff?.DisplayName ||
      [raw.Staff?.FirstName, raw.Staff?.LastName].filter(Boolean).join(" ") ||
      "Sandbox Staff",
    court: raw.Resource?.Name || "Clubville",
    spotsAvailable: Math.max(0, capacity - booked),
    maxCapacity: capacity,
    recurrence: "Live Mindbody public-sandbox occurrence",
    startsAt: raw.StartDateTime,
  };
}

async function getSandboxClassRows(now = new Date()): Promise<MindBodyClass[]> {
  const today = dateInTimeZone(now, SANDBOX_TIMEZONE);
  const currentWallClock = dateTimeInTimeZone(now, SANDBOX_TIMEZONE);
  const log = createLogger(`e2e-catalog-${today}`);
  const result = await authedMindbodyGet<{ Classes?: MindBodyClass[] }>(log, {
    siteIdOverride: SANDBOX_SITE_ID,
    path: "/class/classes",
    query: {
      StartDateTime: `${today}T00:00:00`,
      EndDateTime: `${addDays(today, 14)}T23:59:59`,
      ProgramIds: String(SANDBOX_PROGRAM_ID),
      Limit: 200,
    },
    staffMode: true,
  });
  return (result.Classes ?? [])
    .filter((candidate) => {
      const capacity = Number(candidate.WebCapacity ?? candidate.MaxCapacity ?? 0);
      const booked = Number(candidate.WebBooked ?? candidate.TotalBooked ?? 0);
      return (
        Number(candidate.ClassScheduleId) === SANDBOX_CLASS_SCHEDULE_ID &&
        Number(candidate.ClassDescription?.Program?.Id) === SANDBOX_PROGRAM_ID &&
        Number(candidate.Location?.SiteID) === SANDBOX_SITE_ID_NUMBER &&
        Number(candidate.Location?.Id) === SANDBOX_LOCATION_ID &&
        candidate.StartDateTime > currentWallClock &&
        !candidate.IsCanceled &&
        candidate.IsAvailable !== false &&
        capacity - booked > 0
      );
    })
    .sort((a, b) => a.StartDateTime.localeCompare(b.StartDateTime));
}

export async function getTrialE2ESandboxFixtureClass(
  now = new Date(),
): Promise<TrialClass> {
  const row = (await getSandboxClassRows(now))[0];
  if (!row) {
    throw new Error(
      "No available Site -99 Schedule 2180 occurrence was found in the next 14 days.",
    );
  }
  return mapSandboxClass(row);
}

async function verifySandboxClass(
  request: TrialRequest,
  now = new Date(),
): Promise<TrialClass> {
  const row = (await getSandboxClassRows(now)).find(
    (candidate) =>
      Number(candidate.Id) === request.classId &&
      Number(candidate.ClassScheduleId) === request.classScheduleId &&
      candidate.StartDateTime === request.classStartsAt,
  );
  if (!row) {
    throw new TrialE2EValidationError([
      "The selected Site -99 occurrence is no longer available; reload the protected fixture.",
    ]);
  }
  return mapSandboxClass(row);
}

function deterministicId(
  prefix: string,
  submissionId: string,
  signingSecret: string,
): string {
  const fragment = crypto
    .createHmac("sha256", signingSecret)
    .update(`${prefix}:${submissionId}`)
    .digest("hex")
    .slice(0, 14);
  return `${prefix}_test_${fragment}`;
}

function stage(
  key: string,
  label: string,
  system: TrialE2EStageSystem,
  evidence: string,
  at: string,
  status: TrialE2EStage["status"] = "passed",
): TrialE2EStage {
  return { key, label, system, status, evidence, at };
}

function response(
  receipt: TrialE2EReceipt,
  signingSecret: string,
  cached: boolean,
): TrialE2ERunResponse {
  return {
    ok: true,
    cached,
    status: receipt.state,
    receiptToken: signTrialE2EReceipt(receipt, signingSecret),
    receipt,
  };
}

function birthDateMatches(client: MindbodyClient, birthDate: string): boolean {
  return typeof client.BirthDate === "string" && client.BirthDate.slice(0, 10) === birthDate;
}

function exactClient(
  clients: MindbodyClient[],
  firstName: string,
  lastName: string,
  birthDate: string,
): MindbodyClient | undefined {
  return clients.find(
    (client) =>
      client.FirstName?.trim() === firstName.trim() &&
      client.LastName?.trim() === lastName.trim() &&
      birthDateMatches(client, birthDate),
  );
}

const COMMUNICATION_FLAG_NAMES = [
  "SendAccountEmails",
  "SendScheduleEmails",
  "SendPromotionalEmails",
  "SendAccountTexts",
  "SendScheduleTexts",
  "SendPromotionalTexts",
] as const;

function clientCommunicationFlagsAreFalse(client: MindbodyClient): boolean {
  return COMMUNICATION_FLAG_NAMES.every((name) => client[name] === false);
}

function exactReadbackClient(
  client: MindbodyClient,
  args: {
    firstName: string;
    lastName: string;
    birthDate: string;
    email: string;
    parentId?: string | number;
  },
): boolean {
  return (
    client.FirstName?.trim() === args.firstName.trim() &&
    client.LastName?.trim() === args.lastName.trim() &&
    birthDateMatches(client, args.birthDate) &&
    client.Email?.trim().toLowerCase() === args.email &&
    clientCommunicationFlagsAreFalse(client) &&
    (args.parentId === undefined || hasParentRelationship(client, args.parentId))
  );
}

async function readExactClientById(
  cfg: ReturnType<typeof loadConfigFromEnv>,
  log: ReturnType<typeof createLogger>,
  id: string | number,
  args: {
    firstName: string;
    lastName: string;
    birthDate: string;
    email: string;
    parentId?: string | number;
  },
): Promise<MindbodyClient | undefined> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = (await getClientsByIds(cfg, log, [id])).find(
      (client) => String(client.Id) === String(id),
    );
    if (candidate && exactReadbackClient(candidate, args)) return candidate;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return undefined;
}

function reconciliationRequired(message: string): never {
  throw new TrialE2EReconciliationRequiredError(
    `${message} The started mutation will not be repeated without exact readback evidence.`,
  );
}

function reconciliationCompleted(message: string): never {
  throw new TrialE2EReconciliationRequiredError(
    `${message} Retry once to continue from the durable evidence; this request will not perform a downstream vendor mutation.`,
    true,
  );
}

function hasParentRelationship(client: MindbodyClient, parentId: string | number): boolean {
  const relationships = client.ClientRelationships;
  if (!Array.isArray(relationships)) return false;
  return relationships.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const relation = candidate as {
      RelatedClientId?: unknown;
      RelatedClient?: { Id?: unknown };
      Relationship?: { Id?: unknown };
    };
    const relatedId = relation.RelatedClientId ?? relation.RelatedClient?.Id;
    return (
      String(relatedId) === String(parentId) &&
      Number(relation.Relationship?.Id) === PARENT_GUARDIAN_RELATIONSHIP.Id
    );
  });
}

function notificationFlags() {
  return {
    SendAccountEmails: false,
    SendScheduleEmails: false,
    SendPromotionalEmails: false,
    SendAccountTexts: false,
    SendScheduleTexts: false,
    SendPromotionalTexts: false,
  } as const;
}

export async function runTrialE2ESandboxIntake(
  body: TrialRequest,
  signingSecret: string,
  audience: string,
  journal: TrialE2EJournalController,
  now = new Date(),
): Promise<TrialE2ERunResponse> {
  const liveClass = await verifySandboxClass(body, now);
  const errors = validateTrialE2ERequest(body, now, {
    emailDomain: "court16-test.invalid",
    classId: liveClass.classId,
    classScheduleId: liveClass.classScheduleId,
    className: liveClass.name,
    classStartsAt: liveClass.startsAt,
  });
  if (errors.length > 0) throw new TrialE2EValidationError(errors);

  const cfg = { ...loadConfigFromEnv(), siteId: SANDBOX_SITE_ID };
  const log = createLogger(`e2e-${body.submissionId}`);
  const email = body.parentEmail.trim().toLowerCase();
  const runId = deriveTrialE2ERunId(body.submissionId, signingSecret);
  const initialPhase = journal.current().phase;
  if (
    journal.current().submissionId !== body.submissionId ||
    journal.current().runId !== runId ||
    journal.current().audience !== audience
  ) {
    throw new TrialE2EReconciliationRequiredError(
      "The durable E2E mutation journal does not match this intake.",
    );
  }
  const existing = await getClientsByEmail(cfg, log, email);
  const parentMatches = existing.filter((client) =>
    exactClient(
      [client],
      body.parentFirstName,
      body.parentLastName,
      body.parentBirthDate,
    ),
  );
  const childMatches = existing.filter((client) =>
    exactClient(
      [client],
      body.childFirstName,
      body.childLastName!,
      body.childBirthDate!,
    ),
  );
  const expectedIds = new Set(
    [...parentMatches, ...childMatches].map((client) => String(client.Id)),
  );
  if (
    parentMatches.length > 1 ||
    childMatches.length > 1 ||
    existing.some((client) => !expectedIds.has(String(client.Id)))
  ) {
    throw new Error("The synthetic sandbox email has duplicate or unexpected clients.");
  }
  let parent = exactClient(
    parentMatches,
    body.parentFirstName,
    body.parentLastName,
    body.parentBirthDate,
  );
  let child = exactClient(
    childMatches,
    body.childFirstName,
    body.childLastName!,
    body.childBirthDate!,
  );

  const profile = normalizeMindbodyProfileDetails(body);
  const parentIdentity = {
    firstName: body.parentFirstName,
    lastName: body.parentLastName,
    birthDate: body.parentBirthDate,
    email,
  };
  const childIdentity = {
    firstName: body.childFirstName,
    lastName: body.childLastName!,
    birthDate: body.childBirthDate!,
    email,
  };
  let parentCreatedNow = false;
  let childCreatedNow = false;

  if (journal.current().parentClientId) {
    parent = await readExactClientById(
      cfg,
      log,
      journal.current().parentClientId!,
      parentIdentity,
    );
    if (!parent) reconciliationRequired("The journaled Site -99 parent was not read back exactly.");
  }

  if (journal.current().phase === "initialized") {
    if (parent) {
      const verified = await readExactClientById(cfg, log, parent.Id, parentIdentity);
      if (!verified) {
        throw new Error("The existing Site -99 parent failed exact communication-preference readback.");
      }
      parent = verified;
      await journal.advance("parent_verified", { parentClientId: String(parent.Id) });
    } else {
      await journal.advance("parent_add_started");
      parentCreatedNow = true;
      parent = await addClient(cfg, log, {
        FirstName: body.parentFirstName.trim(),
        LastName: body.parentLastName.trim(),
        Email: email,
        MobilePhone: body.parentPhone,
        BirthDate: body.parentBirthDate,
        Gender: profile.parentGender,
        AddressLine1: profile.householdAddress1,
        AddressLine2: profile.householdAddress2,
        City: profile.householdCity,
        State: profile.householdState,
        PostalCode: profile.householdPostalCode,
        ReferredBy: "Court16 E2E Site -99",
        ...notificationFlags(),
      });
      await journal.advance("parent_add_started", { parentClientId: String(parent.Id) });
      const verified = await readExactClientById(cfg, log, parent.Id, parentIdentity);
      if (!verified) reconciliationRequired("Site -99 parent AddClient outcome is ambiguous.");
      parent = verified;
      await journal.advance("parent_verified", { parentClientId: String(parent.Id) });
    }
  } else if (journal.current().phase === "parent_add_started") {
    const candidateId = journal.current().parentClientId ?? parent?.Id;
    if (candidateId == null) reconciliationRequired("Site -99 parent AddClient outcome is ambiguous.");
    const verified = await readExactClientById(cfg, log, candidateId, parentIdentity);
    if (!verified) reconciliationRequired("Site -99 parent AddClient outcome is ambiguous.");
    parent = verified;
    await journal.advance("parent_verified", { parentClientId: String(parent.Id) });
    if (initialPhase === "parent_add_started") {
      reconciliationCompleted("The Site -99 parent AddClient result was reconciled exactly.");
    }
  }

  if (!parent || !journal.current().parentClientId) {
    reconciliationRequired("The exact Site -99 parent is not durably verified.");
  }

  if (journal.current().childClientId) {
    child = await readExactClientById(cfg, log, journal.current().childClientId!, {
      ...childIdentity,
      parentId: parent.Id,
    });
    if (!child) reconciliationRequired("The journaled Site -99 child was not read back exactly.");
  }

  if (journal.current().phase === "parent_verified") {
    if (child) {
      const verified = await readExactClientById(cfg, log, child.Id, {
        ...childIdentity,
        parentId: parent.Id,
      });
      if (!verified) {
        throw new Error("The existing Site -99 child failed exact relationship or communication-preference readback.");
      }
      child = verified;
      await journal.advance("family_verified", { childClientId: String(child.Id) });
    } else {
      await journal.advance("child_add_started");
      childCreatedNow = true;
      child = await addClient(cfg, log, {
        FirstName: body.childFirstName.trim(),
        LastName: body.childLastName!.trim(),
        Email: email,
        MobilePhone: body.parentPhone,
        BirthDate: body.childBirthDate,
        Gender: profile.childGender,
        AddressLine1: profile.householdAddress1,
        AddressLine2: profile.householdAddress2,
        City: profile.householdCity,
        State: profile.householdState,
        PostalCode: profile.householdPostalCode,
        ReferredBy: "Court16 E2E Site -99",
        ClientRelationships: [
          {
            RelatedClientId: String(parent.Id),
            RelationshipName: PARENT_GUARDIAN_RELATIONSHIP.RelationshipName2,
            Relationship: { ...PARENT_GUARDIAN_RELATIONSHIP },
          },
        ],
        ...notificationFlags(),
      });
      await journal.advance("child_add_started", { childClientId: String(child.Id) });
      const verified = await readExactClientById(cfg, log, child.Id, {
        ...childIdentity,
        parentId: parent.Id,
      });
      if (!verified) reconciliationRequired("Site -99 child AddClient outcome is ambiguous.");
      child = verified;
      await journal.advance("family_verified", { childClientId: String(child.Id) });
    }
  } else if (journal.current().phase === "child_add_started") {
    const candidateId = journal.current().childClientId ?? child?.Id;
    if (candidateId == null) reconciliationRequired("Site -99 child AddClient outcome is ambiguous.");
    const verified = await readExactClientById(cfg, log, candidateId, {
      ...childIdentity,
      parentId: parent.Id,
    });
    if (!verified) reconciliationRequired("Site -99 child AddClient outcome is ambiguous.");
    child = verified;
    await journal.advance("family_verified", { childClientId: String(child.Id) });
  }

  if (!journalPhaseIsAtLeastFamilyVerified(journal.current().phase)) {
    reconciliationRequired("The Site -99 family journal is incomplete.");
  }
  if (!parent || !child || !journal.current().childClientId) {
    reconciliationRequired("The exact Site -99 family is not durably verified.");
  }

  const parentReadback = await readExactClientById(cfg, log, parent.Id, parentIdentity);
  const childReadback = await readExactClientById(cfg, log, child.Id, {
    ...childIdentity,
    parentId: parent.Id,
  });
  if (!parentReadback || !childReadback) {
    throw new Error("Mindbody Site -99 exact family readback was incomplete.");
  }

  /*
   * Once a `*_started` phase is durable, this function never calls that
   * mutation again. A missing readback is intentionally terminal for this run.
   */
  parent = parentReadback;
  child = childReadback;

  const at = now.toISOString();
  const receipt: TrialE2EReceipt = {
    version: 1,
    purpose: "trial_e2e_receipt",
    audience,
    mode: "mindbody_sandbox",
    runId,
    submissionId: body.submissionId,
    state: "pending_staff",
    issuedAt: at,
    expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
    classSelection: {
      classId: liveClass.classId,
      classScheduleId: liveClass.classScheduleId,
      className: liveClass.name,
      startsAt: liveClass.startsAt,
    },
    ids: {
      contactId: deterministicId("contact", body.submissionId, signingSecret),
      dealId: deterministicId("deal", body.submissionId, signingSecret),
      parentClientId: String(parent.Id),
      childClientId: String(child.Id),
      relationshipId: String(PARENT_GUARDIAN_RELATIONSHIP.Id),
      ...(journal.current().saleId ? { saleId: journal.current().saleId } : {}),
      ...(journal.current().visitId ? { visitId: journal.current().visitId } : {}),
    },
    notificationEvidence: {
      hubspotAdapterInvoked: false,
      staffNotifierInvoked: false,
      adminNotifierInvoked: false,
      mindbodyClientCommunicationFlags: "all_false",
      mindbodyClassSendEmail: "not_applicable",
      externalDeliveryObservation: "not_observed",
    },
    confirmationAttempts: 0,
    stages: [
      stage(
        "request_validated",
        "Production form and live class validated",
        "application",
        "The family payload passed and the occurrence was re-read from Site -99, Program 26, Location 1, Schedule 2180.",
        at,
      ),
      stage(
        "notification_guard",
        "Notification requests configured off",
        "notification_guard",
        "HubSpot and Court16 notifiers are absent; all six client communication flags were read back false. Any later AddClientToClass fallback is hard-coded with SendEmail false. External delivery is not observed.",
        at,
      ),
      stage(
        "crm_contact_upserted",
        "Test CRM contact upserted",
        "crm_fixture",
        "A deterministic signed-ledger Contact ID was returned; no HubSpot API is imported or called.",
        at,
      ),
      stage(
        "crm_deal_intake_started",
        "Production Deal-ledger contract entered intake",
        "crm_fixture",
        "The production serializer, parser, and pending_staff state validator passed; no HubSpot network adapter exists here.",
        at,
      ),
      stage(
        "mindbody_parent_created",
        "Site -99 parent client verified",
        "mindbody_fixture",
        `Direct ClientId and six communication-flag readback passed${parentCreatedNow ? " after AddClient" : " using existing journal-bound evidence"}.`,
        at,
        parentCreatedNow ? "passed" : "cached",
      ),
      stage(
        "mindbody_child_created",
        "Site -99 child client verified",
        "mindbody_fixture",
        `Direct ClientId, relationship, and six communication-flag readback passed${childCreatedNow ? " after AddClient" : " using existing journal-bound evidence"}.`,
        at,
        childCreatedNow ? "passed" : "cached",
      ),
      stage(
        "family_relationship_verified",
        "Site -99 Parent/Guardian relationship read back",
        "mindbody_fixture",
        "Relationship -6 points from the child fixture to the exact parent ClientId.",
        at,
      ),
      stage(
        "ledger_pending_staff",
        "Signed test ledger advanced to pending staff",
        "crm_fixture",
        "The live sandbox client IDs and exact occurrence coordinates are sealed into the receipt.",
        at,
      ),
    ],
    verificationScope: [
      "real two-step TrialRequestForm interaction and protected payload validation",
      "browser-to-API request contract",
      "signed request-scoped Contact and Deal ledger transitions",
      "live Site -99 client creation or exact reconciliation with all six communication flags read back false",
      "real Site -99 inline Parent/Guardian relationship and direct ClientId readback",
      "direct staff confirmation, $0 Service 1377 checkout, enrollment, and active Visit readback",
      "read-before-write retry reconciliation and zero application notification adapters",
    ],
    limitations: [
      "CRM evidence is a signed deterministic ledger; no HubSpot portal is called.",
      "Site -99 is Mindbody's shared disposable sandbox, and records may remain until it resets.",
      "Only a staff-approved production fixture can prove Court 16-specific permissions and live workflow routing.",
    ],
  };

  assertTrialE2ELedgerContract(receipt);

  return response(receipt, signingSecret, !parentCreatedNow && !childCreatedNow);
}

function availableService(
  services: ClientService[],
  expectedId?: string,
): ClientService | undefined {
  const now = Date.now();
  return services
    .filter((service) => {
      const remaining = Number(service.Remaining ?? service.Count ?? 0);
      const expiration = service.ExpirationDate ? Date.parse(service.ExpirationDate) : Infinity;
      return (
        service.Id != null &&
        (expectedId === undefined || String(service.Id) === expectedId) &&
        Number(service.ProductId) === SANDBOX_SERVICE_ID &&
        service.Name === SANDBOX_SERVICE_NAME &&
        Number(service.SiteId) === SANDBOX_SITE_ID_NUMBER &&
        remaining > 0 &&
        (!Number.isFinite(expiration) || expiration >= now)
      );
    })
    .sort((a, b) => Date.parse(b.PaymentDate ?? "") - Date.parse(a.PaymentDate ?? ""))[0];
}

async function readService(
  childId: string,
  attempts: number,
  log: ReturnType<typeof createLogger>,
  expectedId?: string,
): Promise<ClientService | undefined> {
  const cfg = { ...loadConfigFromEnv(), siteId: SANDBOX_SITE_ID };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const service = availableService(
      await getClientServices(cfg, log, childId),
      expectedId,
    );
    if (service) return service;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return undefined;
}

async function readVisit(
  receipt: TrialE2EReceipt,
  log: ReturnType<typeof createLogger>,
  attempts: number,
  service?: ClientService,
): Promise<ClientVisit | undefined> {
  const cfg = { ...loadConfigFromEnv(), siteId: SANDBOX_SITE_ID };
  const date = receipt.classSelection.startsAt.slice(0, 10);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const visits = await getClientVisits(cfg, log, {
      clientId: receipt.ids.childClientId,
      startDate: addDays(date, -1),
      endDate: addDays(date, 1),
    });
    const visit = findExactActiveClientVisit(visits, {
      clientId: receipt.ids.childClientId,
      classId: receipt.classSelection.classId,
      siteId: SANDBOX_SITE_ID_NUMBER,
      locationId: SANDBOX_LOCATION_ID,
      ...(service
        ? {
            productId: SANDBOX_SERVICE_ID,
            serviceName: SANDBOX_SERVICE_NAME,
            clientServiceId: service.Id,
          }
        : {}),
    });
    if (visit) return visit;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return undefined;
}

function confirmedReceipt(
  current: TrialE2EReceipt,
  visit: ClientVisit,
  at: string,
  args: {
    saleId?: string | number;
    creditSource: "existing" | "checkout" | "reconciled_checkout";
    enrollmentSource:
      | "existing"
      | "checkout"
      | "add_to_class"
      | "reconciled_add_to_class";
    classSendEmail: "false" | "not_applicable";
    retry: boolean;
  },
): TrialE2EReceipt {
  const hasRetry = current.stages.some((entry) => entry.key === "idempotent_confirm_retry");
  const confirmationStages = current.state === "confirmed"
    ? []
    : [
        stage(
          "staff_receipt_verified",
          "Signed test-staff action verified",
          "application",
          "The direct action matched the pending Site -99 request and sealed occurrence.",
          at,
        ),
        stage(
          "trial_credit_checked_out",
          "$0 Site -99 service credit verified",
          "mindbody_fixture",
          args.creditSource === "existing"
            ? "Existing Service 1377 was reconciled before any checkout request."
            : args.creditSource === "checkout"
              ? "A positive-SaleId Comp checkout produced generic sandbox Service 1377."
              : "A previously started Comp checkout was reconciled by exact Service 1377 readback; the checkout was not repeated.",
          at,
          args.creditSource === "existing" ? "cached" : "passed",
        ),
        stage(
          "class_enrollment_created",
          "Site -99 child enrolled in selected class",
          "mindbody_fixture",
          args.enrollmentSource === "existing"
            ? "The exact active Visit already existed, so no enrollment request was made."
            : args.enrollmentSource === "checkout"
              ? "The checkout-created Visit was read back; no AddClientToClass request was needed."
              : args.enrollmentSource === "add_to_class"
                ? "AddClientToClass enrolled the exact occurrence with SendEmail false."
                : "A previously started AddClientToClass request with SendEmail false was reconciled by exact Visit readback; it was not repeated.",
          at,
          args.enrollmentSource === "existing" ? "cached" : "passed",
        ),
        stage(
          "active_visit_readback",
          "Site -99 active Visit read back",
          "mindbody_fixture",
          "ClientId, ClassId, Site -99, Location 1, Product 1377, service instance, and active state all match.",
          at,
        ),
        stage(
          "ledger_confirmed",
          "Signed test Deal ledger advanced to confirmed",
          "crm_fixture",
          "The Visit evidence was sealed before confirmed state was returned.",
          at,
        ),
        stage(
          "notification_requests_disabled",
          "Notification request settings stayed disabled",
          "notification_guard",
          "No HubSpot, staff, or admin adapter was invoked. Client communication flags were read back false; when AddClientToClass ran, its SendEmail request was false. External delivery is not independently observed.",
          at,
        ),
      ];
  const retryStage = args.retry && !hasRetry
    ? [
        stage(
          "idempotent_confirm_retry",
          "Confirmation retry returned read-only cached evidence",
          "application",
          "The retry re-read the exact active Visit and did not request checkout or enrollment.",
          at,
          "cached",
        ),
      ]
    : [];
  const receipt: TrialE2EReceipt = {
    ...current,
    state: "confirmed",
    confirmationAttempts: current.confirmationAttempts + 1,
    ids: {
      ...current.ids,
      ...(args.saleId ? { saleId: String(args.saleId) } : {}),
      visitId: String(visit.Id),
    },
    notificationEvidence: {
      ...current.notificationEvidence,
      mindbodyClassSendEmail: args.classSendEmail,
    },
    stages: [...current.stages, ...confirmationStages, ...retryStage],
  };
  assertTrialE2ELedgerContract(receipt);
  return receipt;
}

export async function runTrialE2ESandboxConfirmation(
  receiptToken: string,
  signingSecret: string,
  audience: string,
  journal: TrialE2EJournalController,
  now = new Date(),
): Promise<TrialE2ERunResponse> {
  const current = verifyTrialE2EReceipt(receiptToken, signingSecret, now, {
    audience,
    mode: "mindbody_sandbox",
  });
  const journalState = journal.current();
  if (
    journalState.submissionId !== current.submissionId ||
    journalState.runId !== current.runId ||
    journalState.audience !== audience ||
    !journalPhaseIsAtLeastFamilyVerified(journalState.phase) ||
    journalState.parentClientId !== current.ids.parentClientId ||
    journalState.childClientId !== current.ids.childClientId ||
    (current.ids.saleId !== undefined &&
      journalState.saleId !== current.ids.saleId) ||
    (current.ids.visitId !== undefined &&
      journalState.visitId !== current.ids.visitId)
  ) {
    reconciliationRequired("The receipt does not match its durable Site -99 mutation journal.");
  }
  if (
    current.state === "confirmed" &&
    !["visit_verified", "confirmed"].includes(journalState.phase)
  ) {
    reconciliationRequired("The confirmed receipt is ahead of its durable Site -99 journal.");
  }

  const cfg = { ...loadConfigFromEnv(), siteId: SANDBOX_SITE_ID };
  const log = createLogger(`e2e-${current.submissionId}`);
  const at = now.toISOString();
  const initialPhase = journal.current().phase;
  let didCheckout = false;
  let didAddToClass = false;
  let service = await readService(
    current.ids.childClientId,
    3,
    log,
    journal.current().clientServiceId,
  );
  let visit = service ? await readVisit(current, log, 3, service) : undefined;

  if (journal.current().phase === "checkout_started") {
    if (!service) reconciliationRequired("Site -99 checkout outcome is ambiguous.");
    await journal.advance("service_verified", {
      clientServiceId: String(service.Id),
    });
    if (initialPhase === "checkout_started") {
      reconciliationCompleted("The Site -99 checkout result was reconciled exactly.");
    }
  } else if (journal.current().phase === "enrollment_started") {
    if (!service || !visit) {
      reconciliationRequired("Site -99 AddClientToClass outcome is ambiguous.");
    }
    await journal.advance("visit_verified", { visitId: String(visit.Id) });
  }

  if (journal.current().phase === "family_verified") {
    if (service) {
      await journal.advance("service_verified", {
        clientServiceId: String(service.Id),
      });
    } else {
      const requestShape = {
        classId: current.classSelection.classId,
        classScheduleId: current.classSelection.classScheduleId,
        classStartsAt: current.classSelection.startsAt,
      } as TrialRequest;
      await verifySandboxClass(requestShape, now);
      await journal.advance("checkout_started");
      didCheckout = true;
      const checkout = await checkoutTrialBooking(cfg, log, {
        ClientId: current.ids.childClientId,
        ServiceId: SANDBOX_SERVICE_ID,
        ClassId: current.classSelection.classId,
        LocationId: SANDBOX_LOCATION_ID,
        CorrelationId: current.runId,
      });
      if (!(checkout.saleId > 0)) {
        reconciliationRequired("Site -99 checkout returned an invalid SaleId.");
      }
      if (checkout.serviceName !== SANDBOX_SERVICE_NAME) {
        reconciliationRequired("Site -99 checkout returned an unexpected service.");
      }
      await journal.advance("checkout_started", {
        saleId: String(checkout.saleId),
        ...(checkout.visit?.Id != null
          ? { visitId: String(checkout.visit.Id) }
          : {}),
      });
      service = await readService(current.ids.childClientId, 4, log);
      if (!service) reconciliationRequired("Site -99 checkout outcome is ambiguous.");
      await journal.advance("service_verified", {
        clientServiceId: String(service.Id),
      });
      visit = await readVisit(current, log, 3, service);
    }
  }

  if (journal.current().phase === "service_verified") {
    service = await readService(
      current.ids.childClientId,
      3,
      log,
      journal.current().clientServiceId,
    );
    if (!service || String(service.Id) !== journal.current().clientServiceId) {
      reconciliationRequired("The journaled Site -99 service was not read back exactly.");
    }
    visit = await readVisit(current, log, 3, service);
    if (visit) {
      await journal.advance("visit_verified", { visitId: String(visit.Id) });
    } else {
      const requestShape = {
        classId: current.classSelection.classId,
        classScheduleId: current.classSelection.classScheduleId,
        classStartsAt: current.classSelection.startsAt,
      } as TrialRequest;
      await verifySandboxClass(requestShape, now);
      await journal.advance("enrollment_started");
      didAddToClass = true;
      try {
        const enrollment = await addClientToClass(cfg, log, {
          ClientId: current.ids.childClientId,
          ClassId: current.classSelection.classId,
          ClientServiceId: Number(service.Id),
          SendEmail: false,
          Waitlist: false,
        });
        if (enrollment.Visit?.Id != null) {
          await journal.advance("enrollment_started", {
            visitId: String(enrollment.Visit.Id),
          });
        }
      } catch (error) {
        if (!isAlreadyBookedError(error)) throw error;
      }
      visit = await readVisit(current, log, 4, service);
      if (!visit) reconciliationRequired("Site -99 AddClientToClass outcome is ambiguous.");
      await journal.advance("visit_verified", { visitId: String(visit.Id) });
    }
  }

  if (!["visit_verified", "confirmed"].includes(journal.current().phase)) {
    reconciliationRequired("The Site -99 confirmation journal is incomplete.");
  }
  service = await readService(
    current.ids.childClientId,
    3,
    log,
    journal.current().clientServiceId,
  );
  visit = service ? await readVisit(current, log, 3, service) : undefined;
  if (
    !service ||
    !visit ||
    String(service.Id) !== journal.current().clientServiceId ||
    String(visit.Id) !== journal.current().visitId
  ) {
    reconciliationRequired("The journaled Site -99 service or Visit was not read back exactly.");
  }
  if (journal.current().phase === "visit_verified") {
    await journal.advance("confirmed");
  }

  const receipt = confirmedReceipt(current, visit, at, {
    saleId: journal.current().saleId,
    creditSource: didCheckout
      ? "checkout"
      : initialPhase === "checkout_started"
        ? "reconciled_checkout"
        : "existing",
    enrollmentSource: didAddToClass
      ? "add_to_class"
      : initialPhase === "enrollment_started"
        ? "reconciled_add_to_class"
      : didCheckout
        ? "checkout"
        : "existing",
    classSendEmail:
      current.notificationEvidence.mindbodyClassSendEmail === "false" ||
      didAddToClass ||
      initialPhase === "enrollment_started"
        ? "false"
        : "not_applicable",
    retry: current.state === "confirmed" || initialPhase === "confirmed",
  });
  return response(
    receipt,
    signingSecret,
    !didCheckout && !didAddToClass,
  );
}
