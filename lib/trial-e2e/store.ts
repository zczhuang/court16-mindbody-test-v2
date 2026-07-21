import { createHash, randomUUID } from "node:crypto";
import {
  advanceTrialE2EJournal,
  createTrialE2EJournal,
  signTrialE2EJournal,
  verifyTrialE2EJournal,
  type TrialE2EJournalController,
  type TrialE2EJournalPatch,
  type TrialE2EJournalPhase,
} from "./journal.ts";

const REQUEST_TIMEOUT_MS = 5_000;
const RECEIPT_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 3 * 60;
const RELEASE_SCRIPT =
  'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
const COMPARE_AND_SET_SCRIPT =
  'if redis.call("get",KEYS[1]) == ARGV[1] then redis.call("set",KEYS[1],ARGV[2],"EX",ARGV[3]); return 1 else return 0 end';

export interface TrialE2EStoreConfig {
  url: string;
  token: string;
  audience: string;
}

interface RedisResult {
  result?: unknown;
  error?: unknown;
}

export class TrialE2EStoreError extends Error {
  readonly code: "unavailable" | "invalid_response";

  constructor(code: "unavailable" | "invalid_response", message: string) {
    super(message);
    this.name = "TrialE2EStoreError";
    this.code = code;
  }
}

function key(
  config: TrialE2EStoreConfig,
  kind: "journal" | "lock" | "receipt",
  scope: string,
): string {
  const digest = createHash("sha256")
    .update(`court16-trial-e2e:v1\0${config.audience}\0${kind}\0${scope}`)
    .digest("hex");
  return `court16:trial-e2e:v1:${kind}:${digest}`;
}

async function command(
  config: TrialE2EStoreConfig,
  args: string[],
  fetchImpl: typeof fetch,
): Promise<RedisResult> {
  let response: Response;
  try {
    response = await fetchImpl(config.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TrialE2EStoreError("unavailable", "The dedicated E2E store is unavailable.");
  }
  if (!response.ok) {
    throw new TrialE2EStoreError(
      "unavailable",
      `The dedicated E2E store returned HTTP ${response.status}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new TrialE2EStoreError("invalid_response", "The E2E store returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TrialE2EStoreError("invalid_response", "The E2E store response was invalid.");
  }
  const result = parsed as RedisResult;
  if (result.error !== undefined && result.error !== null) {
    throw new TrialE2EStoreError("unavailable", "The E2E store rejected the command.");
  }
  return result;
}

export async function acquireTrialE2ELock(
  config: TrialE2EStoreConfig,
  scope: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ release(): Promise<void> } | null> {
  const lockKey = key(config, "lock", scope);
  const owner = randomUUID();
  const acquired = await command(
    config,
    ["SET", lockKey, owner, "NX", "EX", String(LOCK_TTL_SECONDS)],
    fetchImpl,
  );
  if (acquired.result === null) return null;
  if (acquired.result !== "OK") {
    throw new TrialE2EStoreError("invalid_response", "The E2E lock response was ambiguous.");
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      const result = await command(
        config,
        ["EVAL", RELEASE_SCRIPT, "1", lockKey, owner],
        fetchImpl,
      );
      if (result.result !== 0 && result.result !== 1) {
        throw new TrialE2EStoreError(
          "invalid_response",
          "The E2E lock release response was ambiguous.",
        );
      }
    },
  };
}

export async function getStoredTrialE2EReceipt(
  config: TrialE2EStoreConfig,
  submissionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const result = await command(
    config,
    ["GET", key(config, "receipt", submissionId)],
    fetchImpl,
  );
  if (result.result === null) return null;
  if (typeof result.result !== "string") {
    throw new TrialE2EStoreError("invalid_response", "The stored E2E receipt was invalid.");
  }
  return result.result;
}

export async function storeTrialE2EReceipt(
  config: TrialE2EStoreConfig,
  submissionId: string,
  receiptToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const result = await command(
    config,
    [
      "SET",
      key(config, "receipt", submissionId),
      receiptToken,
      "EX",
      String(RECEIPT_TTL_SECONDS),
    ],
    fetchImpl,
  );
  if (result.result !== "OK") {
    throw new TrialE2EStoreError("invalid_response", "The E2E receipt was not persisted.");
  }
}

function remainingJournalTtlSeconds(expiresAt: string): number {
  const remaining = Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new TrialE2EStoreError("invalid_response", "The E2E mutation journal expired.");
  }
  return Math.min(RECEIPT_TTL_SECONDS, remaining);
}

export async function openTrialE2EJournal(
  config: TrialE2EStoreConfig,
  args: {
    submissionId: string;
    runId: string;
    signingSecret: string;
    createIfMissing: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TrialE2EJournalController> {
  const journalKey = key(config, "journal", args.submissionId);
  let stored = await command(config, ["GET", journalKey], fetchImpl);
  let token = stored.result;

  if (token === null) {
    if (!args.createIfMissing) {
      throw new TrialE2EStoreError(
        "invalid_response",
        "The durable E2E mutation journal was not found.",
      );
    }
    const initial = createTrialE2EJournal({
      audience: config.audience,
      submissionId: args.submissionId,
      runId: args.runId,
    });
    const initialToken = signTrialE2EJournal(initial, args.signingSecret);
    const created = await command(
      config,
      [
        "SET",
        journalKey,
        initialToken,
        "NX",
        "EX",
        String(remainingJournalTtlSeconds(initial.expiresAt)),
      ],
      fetchImpl,
    );
    if (created.result === "OK") {
      token = initialToken;
    } else if (created.result === null) {
      stored = await command(config, ["GET", journalKey], fetchImpl);
      token = stored.result;
    } else {
      throw new TrialE2EStoreError(
        "invalid_response",
        "The E2E mutation journal initialization was ambiguous.",
      );
    }
  }

  if (typeof token !== "string") {
    throw new TrialE2EStoreError("invalid_response", "The stored E2E journal was invalid.");
  }
  let currentToken = token;
  let currentJournal = verifyTrialE2EJournal(
    currentToken,
    args.signingSecret,
    {
      audience: config.audience,
      submissionId: args.submissionId,
      runId: args.runId,
    },
  );

  return {
    current() {
      return currentJournal;
    },
    async advance(
      phase: TrialE2EJournalPhase,
      patch: TrialE2EJournalPatch = {},
    ) {
      const nextJournal = advanceTrialE2EJournal(currentJournal, phase, patch);
      const nextToken = signTrialE2EJournal(nextJournal, args.signingSecret);
      const result = await command(
        config,
        [
          "EVAL",
          COMPARE_AND_SET_SCRIPT,
          "1",
          journalKey,
          currentToken,
          nextToken,
          String(remainingJournalTtlSeconds(nextJournal.expiresAt)),
        ],
        fetchImpl,
      );
      if (result.result !== 1) {
        throw new TrialE2EStoreError(
          "invalid_response",
          "The E2E mutation journal changed concurrently.",
        );
      }
      currentToken = nextToken;
      currentJournal = nextJournal;
      return currentJournal;
    },
  };
}
