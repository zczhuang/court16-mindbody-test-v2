import crypto from "node:crypto";
import type { TrialRequest } from "../trial-types";
import {
  MAX_KIDS_TRIAL_AGE,
  MIN_KIDS_TRIAL_AGE,
  isValidIsoDate,
  validateMindbodyProfileDetails,
  validateSingleTrialChildPayload,
} from "../trial-intake.ts";
import { validateTrialReportingDetails } from "../trial-reporting.ts";
import {
  TRIAL_E2E_CLASS_ID,
  TRIAL_E2E_CLASS_NAME,
  TRIAL_E2E_CLASS_SCHEDULE_ID,
  TRIAL_E2E_LOCATION_ID,
  makeTrialE2EInitialValues,
} from "./fixtures.ts";
import type {
  TrialE2EReceipt,
  TrialE2ERunResponse,
  TrialE2EStage,
  TrialE2EStageSystem,
} from "./types";
import { assertTrialE2ELedgerContract } from "./ledger-contract.ts";

const RECEIPT_VERSION = 1;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

export class TrialE2EValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super("The isolated trial test request is invalid.");
    this.name = "TrialE2EValidationError";
    this.errors = errors;
  }
}

export class TrialE2EReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialE2EReceiptError";
  }
}

function base64urlEncode(value: Buffer): string {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function receiptSignature(body: string, signingSecret: string): string {
  return base64urlEncode(
    crypto.createHmac("sha256", signingSecret).update(`receipt:${body}`).digest(),
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signTrialE2EReceipt(
  receipt: TrialE2EReceipt,
  signingSecret: string,
): string {
  const body = base64urlEncode(Buffer.from(JSON.stringify(receipt), "utf8"));
  return `${body}.${receiptSignature(body, signingSecret)}`;
}

export function verifyTrialE2EReceipt(
  token: string,
  signingSecret: string,
  now = new Date(),
  expected?: {
    audience?: string;
    mode?: TrialE2EReceipt["mode"];
  },
): TrialE2EReceipt {
  const [body, signature, ...extra] = token.split(".");
  if (!body || !signature || extra.length > 0) {
    throw new TrialE2EReceiptError("Malformed E2E receipt.");
  }
  if (!safeEqual(signature, receiptSignature(body, signingSecret))) {
    throw new TrialE2EReceiptError("Invalid E2E receipt signature.");
  }

  let receipt: TrialE2EReceipt;
  try {
    receipt = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TrialE2EReceipt;
  } catch {
    throw new TrialE2EReceiptError("Malformed E2E receipt payload.");
  }

  if (
    receipt.version !== RECEIPT_VERSION ||
    receipt.purpose !== "trial_e2e_receipt" ||
    typeof receipt.audience !== "string" ||
    !["fixture", "mindbody_sandbox"].includes(receipt.mode) ||
    !["pending_staff", "confirmed"].includes(receipt.state) ||
    typeof receipt.runId !== "string" ||
    typeof receipt.submissionId !== "string" ||
    !Array.isArray(receipt.stages)
  ) {
    throw new TrialE2EReceiptError("Unsupported E2E receipt payload.");
  }
  if (expected?.audience && receipt.audience !== expected.audience) {
    throw new TrialE2EReceiptError("E2E receipt audience mismatch.");
  }
  if (expected?.mode && receipt.mode !== expected.mode) {
    throw new TrialE2EReceiptError("E2E receipt backend mismatch.");
  }
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) {
    throw new TrialE2EReceiptError("Expired E2E receipt.");
  }
  return receipt;
}

function ageOnDate(isoDate: string, now = new Date()): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const birthdayHasPassed =
    now.getUTCMonth() + 1 > month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!birthdayHasPassed) age -= 1;
  return age;
}

export function validateTrialE2ERequest(
  body: TrialRequest | undefined,
  now = new Date(),
  expected: {
    emailDomain?: "example.invalid" | "court16-test.invalid";
    classId?: number;
    classScheduleId?: number;
    className?: string;
    classStartsAt?: string;
  } = {},
): string[] {
  if (!body || typeof body !== "object") return ["request body is required"];
  const errors = [
    ...validateSingleTrialChildPayload(body.children),
    ...validateMindbodyProfileDetails(body),
    ...validateTrialReportingDetails(body),
  ];

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId ?? "")) {
    errors.push("submissionId must be a browser-generated UUID");
  }
  if (!body.parentFirstName?.trim() || !body.parentLastName?.trim()) {
    errors.push("parent first and last name are required");
  }
  const emailDomain = expected.emailDomain ?? "example.invalid";
  if (!(body.parentEmail?.trim().toLowerCase() ?? "").endsWith(`@${emailDomain}`)) {
    errors.push(`test email must use the ${emailDomain} domain`);
  }
  const synthetic = makeTrialE2EInitialValues(body.submissionId ?? "invalid", emailDomain);
  const syntheticKeys: Array<keyof TrialRequest> = [
    "parentFirstName",
    "parentLastName",
    "parentEmail",
    "parentPhone",
    "parentBirthDate",
    "parentGender",
    "childFirstName",
    "childLastName",
    "childBirthDate",
    "childGender",
    "childPlayingLevel",
    "childSchool",
    "leadSource",
    "householdAddress1",
    "householdAddress2",
    "householdCity",
    "householdState",
    "householdPostalCode",
    "notes",
  ];
  for (const key of syntheticKeys) {
    if (String(body[key] ?? "") !== String(synthetic[key] ?? "")) {
      errors.push(`${key} must match the locked synthetic test fixture`);
    }
  }
  if ((body.parentPhone ?? "").replace(/\D/g, "").length < 7) {
    errors.push("parentPhone is invalid");
  }
  if (!isValidIsoDate(body.parentBirthDate) || ageOnDate(body.parentBirthDate, now) < 18) {
    errors.push("parentBirthDate must identify an adult parent or guardian");
  }
  if (!isValidIsoDate(body.childBirthDate)) {
    errors.push("childBirthDate is required");
  } else {
    const age = ageOnDate(body.childBirthDate, now);
    if (age < MIN_KIDS_TRIAL_AGE || age > MAX_KIDS_TRIAL_AGE) {
      errors.push(`child must be age ${MIN_KIDS_TRIAL_AGE}–${MAX_KIDS_TRIAL_AGE}`);
    }
  }
  if (body.locationId !== TRIAL_E2E_LOCATION_ID) {
    errors.push("locationId must identify the isolated E2E fixture");
  }
  if (
    body.classId !== (expected.classId ?? TRIAL_E2E_CLASS_ID) ||
    body.classScheduleId !==
      (expected.classScheduleId ?? TRIAL_E2E_CLASS_SCHEDULE_ID) ||
    body.className !== (expected.className ?? TRIAL_E2E_CLASS_NAME) ||
    (expected.classStartsAt
      ? body.classStartsAt !== expected.classStartsAt
      : !/^\d{4}-\d{2}-\d{2}T16:00:00$/.test(body.classStartsAt ?? ""))
  ) {
    errors.push("class selection does not match the isolated E2E fixture");
  }
  const child = Array.isArray(body.children) ? body.children[0] : undefined;
  if (
    child &&
    (typeof child.firstName !== "string" ||
      typeof child.lastName !== "string" ||
      typeof body.childFirstName !== "string" ||
      child.firstName.trim() !== body.childFirstName.trim() ||
      child.lastName.trim() !== body.childLastName?.trim() ||
      child.birthDate !== body.childBirthDate)
  ) {
    errors.push("top-level child details must match children[0]");
  }
  return [...new Set(errors)];
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

export function runTrialE2EIntake(
  body: TrialRequest,
  signingSecret: string,
  audience: string,
  now = new Date(),
): TrialE2ERunResponse {
  const errors = validateTrialE2ERequest(body, now);
  if (errors.length > 0) throw new TrialE2EValidationError(errors);

  const at = now.toISOString();
  const runId = deterministicId("run", body.submissionId, signingSecret);
  const receipt: TrialE2EReceipt = {
    version: RECEIPT_VERSION,
    purpose: "trial_e2e_receipt",
    audience,
    mode: "fixture",
    runId,
    submissionId: body.submissionId,
    state: "pending_staff",
    issuedAt: at,
    expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
    classSelection: {
      classId: body.classId,
      classScheduleId: body.classScheduleId,
      className: body.className,
      startsAt: body.classStartsAt!,
    },
    ids: {
      contactId: deterministicId("contact", body.submissionId, signingSecret),
      dealId: deterministicId("deal", body.submissionId, signingSecret),
      parentClientId: deterministicId("parent", body.submissionId, signingSecret),
      childClientId: deterministicId("child", body.submissionId, signingSecret),
      relationshipId: deterministicId("relationship", body.submissionId, signingSecret),
    },
    notificationEvidence: {
      hubspotAdapterInvoked: false,
      staffNotifierInvoked: false,
      adminNotifierInvoked: false,
      mindbodyClientCommunicationFlags: "not_applicable",
      mindbodyClassSendEmail: "not_applicable",
      externalDeliveryObservation: "not_observed",
    },
    confirmationAttempts: 0,
    stages: [
      stage(
        "request_validated",
        "Production form payload validated",
        "application",
        "The same required family, reporting, class, and profile contracts passed.",
        at,
      ),
      stage(
        "notification_guard",
        "No notification adapter invoked",
        "notification_guard",
        "The fixture lane has no HubSpot, email, text, workflow, webhook, or staff-notification network adapter.",
        at,
      ),
      stage(
        "idempotency_key_reserved",
        "Deterministic submission mapping simulated",
        "application",
        `Submission ${body.submissionId} deterministically maps to one fixture object set; no durable vendor reservation was made.`,
        at,
      ),
      stage(
        "crm_contact_upserted",
        "CRM contact-upsert contract simulated",
        "crm_fixture",
        "The fixture produced one deterministic Contact-shaped ID; neither HubSpot nor the production intake route was called.",
        at,
      ),
      stage(
        "crm_deal_intake_started",
        "Production Deal-ledger contract entered intake",
        "crm_fixture",
        "The production ledger serializer, parser, and pending_staff state validator passed without a HubSpot network call.",
        at,
      ),
      stage(
        "mindbody_parent_created",
        "Parent-client result simulated",
        "mindbody_fixture",
        "The fixture produced a deterministic parent-client ID; no AddClient request or communication preference was sent.",
        at,
      ),
      stage(
        "mindbody_child_created",
        "Child-client result simulated",
        "mindbody_fixture",
        "The fixture produced a deterministic child-client ID; no AddClient request or account channel was created.",
        at,
      ),
      stage(
        "family_relationship_verified",
        "Family-relationship contract simulated",
        "mindbody_fixture",
        "The fixture represented the Parent/Guardian stage with deterministic parent and child IDs; no vendor readback ran.",
        at,
      ),
      stage(
        "ledger_pending_staff",
        "Fixture ledger advanced to pending staff",
        "crm_fixture",
        "The deterministic fixture IDs and selected class were sealed into the signed receipt.",
        at,
      ),
    ],
    verificationScope: [
      "real two-step TrialRequestForm interaction and protected payload validation",
      "browser-to-isolated-API request contract",
      "production Deal-ledger serializer, parser, and pending/confirmed state validation",
      "deterministic contract simulation for Contact, family, checkout, enrollment, and visit stages",
      "direct test-staff action and signed receipt state transition",
      "signed receipt integrity and received-response retry determinism",
      "structural absence of HubSpot and notification network adapters in fixture mode",
    ],
    limitations: [
      "Vendor writes are deterministic fixtures, not calls to Court 16 HubSpot or Mindbody.",
      "The production trial-intake and staff-confirm route orchestration does not execute in fixture mode.",
      "A separate approved Site -99 acceptance run is still required to prove Mindbody sandbox permissions and catalog IDs.",
      "Only a staff-approved production fixture can prove Court 16-specific $0 checkout and live workflow routing.",
    ],
  };

  assertTrialE2ELedgerContract(receipt);

  return response(receipt, signingSecret, false);
}

export function runTrialE2EConfirmation(
  receiptToken: string,
  signingSecret: string,
  audience: string,
  now = new Date(),
): TrialE2ERunResponse {
  const current = verifyTrialE2EReceipt(receiptToken, signingSecret, now, {
    audience,
    mode: "fixture",
  });
  const at = now.toISOString();

  if (current.state === "confirmed") {
    const alreadyRecorded = current.stages.some(
      (entry) => entry.key === "idempotent_confirm_retry",
    );
    const receipt: TrialE2EReceipt = {
      ...current,
      confirmationAttempts: current.confirmationAttempts + 1,
      stages: alreadyRecorded
        ? current.stages
        : [
            ...current.stages,
            stage(
              "idempotent_confirm_retry",
              "Fixture confirmation retry returned cached evidence",
              "application",
              "The same signed fixture state returned without adding another simulated sale or visit ID; no vendor mutation exists in fixture mode.",
              at,
              "cached",
            ),
          ],
    };
    assertTrialE2ELedgerContract(receipt);
    return response(receipt, signingSecret, true);
  }

  const receipt: TrialE2EReceipt = {
    ...current,
    state: "confirmed",
    confirmationAttempts: current.confirmationAttempts + 1,
    ids: {
      ...current.ids,
      saleId: deterministicId("sale", current.submissionId, signingSecret),
      visitId: deterministicId("visit", current.submissionId, signingSecret),
    },
    stages: [
      ...current.stages,
      stage(
        "staff_receipt_verified",
        "Signed test-staff action verified",
        "application",
        "The direct browser action matched the sealed request and pending_staff ledger.",
        at,
      ),
      stage(
        "trial_credit_checked_out",
        "$0 trial-credit contract simulated",
        "mindbody_fixture",
        "The fixture produced deterministic Comp-sale and trial-credit-shaped evidence; no checkout request ran.",
        at,
      ),
      stage(
        "class_enrollment_created",
        "Class-enrollment result simulated",
        "mindbody_fixture",
        "The fixture associated its child ID with the ClassId sealed at intake; no enrollment request ran.",
        at,
      ),
      stage(
        "active_visit_readback",
        "Active-visit readback result simulated",
        "mindbody_fixture",
        "The fixture produced one deterministic visit-shaped ID for the sealed class; no Mindbody readback ran.",
        at,
      ),
      stage(
        "ledger_confirmed",
        "Confirmed Deal-ledger contract validated",
        "crm_fixture",
        "The production serializer, parser, and confirmed-state validator accepted the simulated evidence before return.",
        at,
      ),
      stage(
        "notification_adapters_idle",
        "Application notification adapters stayed idle",
        "notification_guard",
        "No HubSpot, staff, admin, or vendor notification adapter was invoked; external mailbox delivery is not observed by this fixture.",
        at,
      ),
    ],
  };
  assertTrialE2ELedgerContract(receipt);
  return response(receipt, signingSecret, false);
}
