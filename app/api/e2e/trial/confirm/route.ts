import { NextResponse } from "next/server";
import {
  TrialE2EReceiptError,
  runTrialE2EConfirmation,
  verifyTrialE2EReceipt,
} from "@/lib/trial-e2e/core";
import {
  getTrialE2EPolicy,
  isTrialE2ERequestAuthorized,
  isTrialE2ERequestHostAllowed,
  isTrialE2ESameOriginRequest,
} from "@/lib/trial-e2e/policy";
import {
  TrialE2EReconciliationRequiredError,
  runTrialE2ESandboxConfirmation,
} from "@/lib/trial-e2e/sandbox";
import { TrialE2EJournalError } from "@/lib/trial-e2e/journal";
import {
  TrialE2EStoreError,
  acquireTrialE2ELock,
  getStoredTrialE2EReceipt,
  openTrialE2EJournal,
  storeTrialE2EReceipt,
} from "@/lib/trial-e2e/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export async function POST(req: Request) {
  const policy = getTrialE2EPolicy();
  if (!policy.allowed || !isTrialE2ERequestHostAllowed(req)) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (!isTrialE2ESameOriginRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "Cross-origin request refused" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  if (!isTrialE2ERequestAuthorized(req, policy)) {
    return NextResponse.json(
      { ok: false, error: "Test session expired" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let receiptToken: unknown;
  try {
    ({ receiptToken } = (await req.json()) as { receiptToken?: unknown });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof receiptToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "receiptToken is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    if (policy.backend === "mindbody_sandbox") {
      if (!policy.redisUrl || !policy.redisToken) {
        throw new TrialE2EStoreError("unavailable", "The E2E store is not configured.");
      }
      const submitted = verifyTrialE2EReceipt(
        receiptToken,
        policy.signingSecret,
        new Date(),
        { audience: policy.audience, mode: "mindbody_sandbox" },
      );
      const store = {
        url: policy.redisUrl,
        token: policy.redisToken,
        audience: policy.audience,
      };
      const lock = await acquireTrialE2ELock(
        store,
        `run:${submitted.submissionId}`,
      );
      if (!lock) {
        return NextResponse.json(
          { ok: false, error: "This test confirmation is already running." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      try {
        const latest = await getStoredTrialE2EReceipt(store, submitted.submissionId);
        if (!latest) {
          return NextResponse.json(
            { ok: false, error: "The durable test run was not found." },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }
        const latestReceipt = verifyTrialE2EReceipt(
          latest,
          policy.signingSecret,
          new Date(),
          { audience: policy.audience, mode: "mindbody_sandbox" },
        );
        if (
          latestReceipt.submissionId !== submitted.submissionId ||
          latestReceipt.runId !== submitted.runId ||
          latestReceipt.ids.parentClientId !== submitted.ids.parentClientId ||
          latestReceipt.ids.childClientId !== submitted.ids.childClientId
        ) {
          throw new TrialE2EReceiptError(
            "The submitted receipt does not match the durable test run.",
          );
        }
        const journal = await openTrialE2EJournal(store, {
          submissionId: latestReceipt.submissionId,
          runId: latestReceipt.runId,
          signingSecret: policy.signingSecret,
          createIfMissing: false,
        });
        const result = await runTrialE2ESandboxConfirmation(
          latest,
          policy.signingSecret,
          policy.audience,
          journal,
        );
        await storeTrialE2EReceipt(
          store,
          submitted.submissionId,
          result.receiptToken,
        );
        return NextResponse.json(result, { headers: NO_STORE_HEADERS });
      } finally {
        await lock.release();
      }
    }
    return NextResponse.json(
      runTrialE2EConfirmation(receiptToken, policy.signingSecret, policy.audience),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TrialE2EReceiptError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof TrialE2EReconciliationRequiredError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.retryable
            ? "Exact sandbox evidence was reconciled read-only. Retry this step once to continue; no mutation was repeated."
            : "This sandbox run requires read-only reconciliation; no mutation was repeated.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof TrialE2EStoreError || error instanceof TrialE2EJournalError) {
      return NextResponse.json(
        { ok: false, error: "The dedicated E2E safety store is unavailable." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: false, error: "The isolated confirmation test failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
