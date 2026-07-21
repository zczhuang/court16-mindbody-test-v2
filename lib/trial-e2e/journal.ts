import crypto from "node:crypto";

export const TRIAL_E2E_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;

export type TrialE2EJournalPhase =
  | "initialized"
  | "parent_add_started"
  | "parent_verified"
  | "child_add_started"
  | "family_verified"
  | "checkout_started"
  | "service_verified"
  | "enrollment_started"
  | "visit_verified"
  | "confirmed";

export interface TrialE2EJournal {
  version: 1;
  purpose: "trial_e2e_mutation_journal";
  audience: string;
  mode: "mindbody_sandbox";
  submissionId: string;
  runId: string;
  phase: TrialE2EJournalPhase;
  issuedAt: string;
  updatedAt: string;
  expiresAt: string;
  parentClientId?: string;
  childClientId?: string;
  clientServiceId?: string;
  saleId?: string;
  visitId?: string;
}

export type TrialE2EJournalPatch = Partial<
  Pick<
    TrialE2EJournal,
    "parentClientId" | "childClientId" | "clientServiceId" | "saleId" | "visitId"
  >
>;

export interface TrialE2EJournalController {
  current(): TrialE2EJournal;
  advance(
    phase: TrialE2EJournalPhase,
    patch?: TrialE2EJournalPatch,
  ): Promise<TrialE2EJournal>;
}

export class TrialE2EJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialE2EJournalError";
  }
}

const NEXT_PHASES: Record<TrialE2EJournalPhase, ReadonlySet<TrialE2EJournalPhase>> = {
  initialized: new Set(["parent_add_started", "parent_verified"]),
  parent_add_started: new Set(["parent_add_started", "parent_verified"]),
  parent_verified: new Set(["child_add_started", "family_verified"]),
  child_add_started: new Set(["child_add_started", "family_verified"]),
  family_verified: new Set(["checkout_started", "service_verified"]),
  checkout_started: new Set(["checkout_started", "service_verified"]),
  service_verified: new Set(["enrollment_started", "visit_verified"]),
  enrollment_started: new Set(["enrollment_started", "visit_verified"]),
  visit_verified: new Set(["confirmed"]),
  confirmed: new Set(),
};

const PHASES = new Set<TrialE2EJournalPhase>(
  Object.keys(NEXT_PHASES) as TrialE2EJournalPhase[],
);

function base64urlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(body: string, signingSecret: string): string {
  return base64urlEncode(
    crypto.createHmac("sha256", signingSecret).update(`journal:${body}`).digest(),
  );
}

export function deriveTrialE2ERunId(
  submissionId: string,
  signingSecret: string,
): string {
  const fragment = crypto
    .createHmac("sha256", signingSecret)
    .update(`run:${submissionId}`)
    .digest("hex")
    .slice(0, 14);
  return `run_test_${fragment}`;
}

export function createTrialE2EJournal(args: {
  audience: string;
  submissionId: string;
  runId: string;
  now?: Date;
}): TrialE2EJournal {
  const now = args.now ?? new Date();
  const at = now.toISOString();
  return {
    version: 1,
    purpose: "trial_e2e_mutation_journal",
    audience: args.audience,
    mode: "mindbody_sandbox",
    submissionId: args.submissionId,
    runId: args.runId,
    phase: "initialized",
    issuedAt: at,
    updatedAt: at,
    expiresAt: new Date(now.getTime() + TRIAL_E2E_JOURNAL_TTL_MS).toISOString(),
  };
}

export function signTrialE2EJournal(
  journal: TrialE2EJournal,
  signingSecret: string,
): string {
  const body = base64urlEncode(Buffer.from(JSON.stringify(journal), "utf8"));
  return `${body}.${signature(body, signingSecret)}`;
}

export function verifyTrialE2EJournal(
  token: string,
  signingSecret: string,
  expected: {
    audience: string;
    submissionId: string;
    runId: string;
  },
  now = new Date(),
): TrialE2EJournal {
  const [body, tokenSignature, ...extra] = token.split(".");
  if (!body || !tokenSignature || extra.length > 0) {
    throw new TrialE2EJournalError("Malformed E2E mutation journal.");
  }
  if (!safeEqual(tokenSignature, signature(body, signingSecret))) {
    throw new TrialE2EJournalError("Invalid E2E mutation journal signature.");
  }

  let journal: TrialE2EJournal;
  try {
    journal = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TrialE2EJournal;
  } catch {
    throw new TrialE2EJournalError("Malformed E2E mutation journal payload.");
  }
  if (
    journal.version !== 1 ||
    journal.purpose !== "trial_e2e_mutation_journal" ||
    journal.mode !== "mindbody_sandbox" ||
    !PHASES.has(journal.phase) ||
    journal.audience !== expected.audience ||
    journal.submissionId !== expected.submissionId ||
    journal.runId !== expected.runId
  ) {
    throw new TrialE2EJournalError("E2E mutation journal identity mismatch.");
  }
  const expiresAt = Date.parse(journal.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) {
    throw new TrialE2EJournalError("Expired E2E mutation journal.");
  }
  return journal;
}

export function advanceTrialE2EJournal(
  current: TrialE2EJournal,
  phase: TrialE2EJournalPhase,
  patch: TrialE2EJournalPatch = {},
  now = new Date(),
): TrialE2EJournal {
  if (!NEXT_PHASES[current.phase].has(phase)) {
    throw new TrialE2EJournalError(
      `Unsafe E2E mutation journal transition: ${current.phase} -> ${phase}.`,
    );
  }
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = current[field as keyof TrialE2EJournal];
    if (existing !== undefined && String(existing) !== String(value)) {
      throw new TrialE2EJournalError(`E2E mutation journal ${field} is immutable.`);
    }
  }
  return {
    ...current,
    ...patch,
    phase,
    updatedAt: now.toISOString(),
  };
}

export function journalPhaseIsAtLeastFamilyVerified(
  phase: TrialE2EJournalPhase,
): boolean {
  return ![
    "initialized",
    "parent_add_started",
    "parent_verified",
    "child_add_started",
  ].includes(phase);
}
