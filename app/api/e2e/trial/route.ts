import { NextResponse } from "next/server";
import type { TrialRequest } from "@/lib/trial-types";
import {
  TrialE2EValidationError,
  runTrialE2EIntake,
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
  runTrialE2ESandboxIntake,
} from "@/lib/trial-e2e/sandbox";
import {
  TrialE2EJournalError,
  deriveTrialE2ERunId,
  journalPhaseIsAtLeastFamilyVerified,
} from "@/lib/trial-e2e/journal";
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

  let body: TrialRequest;
  try {
    body = (await req.json()) as TrialRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    if (policy.backend === "mindbody_sandbox") {
      if (!policy.redisUrl || !policy.redisToken) {
        throw new TrialE2EStoreError("unavailable", "The E2E store is not configured.");
      }
      const store = {
        url: policy.redisUrl,
        token: policy.redisToken,
        audience: policy.audience,
      };
      const lock = await acquireTrialE2ELock(store, `run:${body.submissionId}`);
      if (!lock) {
        return NextResponse.json(
          { ok: false, error: "This test intake is already running." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      try {
        const stored = await getStoredTrialE2EReceipt(store, body.submissionId);
        if (stored) {
          const receipt = verifyTrialE2EReceipt(stored, policy.signingSecret, new Date(), {
            audience: policy.audience,
            mode: "mindbody_sandbox",
          });
          const journal = await openTrialE2EJournal(store, {
            submissionId: receipt.submissionId,
            runId: receipt.runId,
            signingSecret: policy.signingSecret,
            createIfMissing: false,
          });
          const journalState = journal.current();
          if (
            receipt.submissionId !== body.submissionId ||
            !journalPhaseIsAtLeastFamilyVerified(journalState.phase) ||
            journalState.parentClientId !== receipt.ids.parentClientId ||
            journalState.childClientId !== receipt.ids.childClientId ||
            (receipt.ids.saleId !== undefined &&
              journalState.saleId !== receipt.ids.saleId) ||
            (receipt.ids.visitId !== undefined &&
              journalState.visitId !== receipt.ids.visitId) ||
            (receipt.state === "confirmed" &&
              (!["visit_verified", "confirmed"].includes(journalState.phase) ||
                journalState.visitId !== receipt.ids.visitId))
          ) {
            throw new TrialE2EStoreError(
              "invalid_response",
              "The stored E2E receipt does not match its mutation journal.",
            );
          }
          return NextResponse.json(
            {
              ok: true,
              cached: true,
              status: receipt.state,
              receiptToken: stored,
              receipt,
            },
            { headers: NO_STORE_HEADERS },
          );
        }
        const journal = await openTrialE2EJournal(store, {
          submissionId: body.submissionId,
          runId: deriveTrialE2ERunId(body.submissionId, policy.signingSecret),
          signingSecret: policy.signingSecret,
          createIfMissing: true,
        });
        const result = await runTrialE2ESandboxIntake(
          body,
          policy.signingSecret,
          policy.audience,
          journal,
        );
        await storeTrialE2EReceipt(
          store,
          body.submissionId,
          result.receiptToken,
        );
        return NextResponse.json(result, { headers: NO_STORE_HEADERS });
      } finally {
        await lock.release();
      }
    }
    return NextResponse.json(
      runTrialE2EIntake(body, policy.signingSecret, policy.audience),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TrialE2EValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message, errors: error.errors },
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
      { ok: false, error: "The isolated intake test failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
