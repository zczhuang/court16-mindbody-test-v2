"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DayDetail from "@/components/DayDetail";
import RedesignChrome from "@/components/RedesignChrome";
import TrialRequestForm from "@/components/TrialRequestForm";
import type { TrialClass, TrialRequest } from "@/lib/trial-types";
import {
  TRIAL_E2E_LOCATION_ID,
  TRIAL_E2E_LOCATION_NAME,
  makeTrialE2EInitialValues,
} from "@/lib/trial-e2e/fixtures";
import type {
  TrialE2EReceipt,
  TrialE2ERunResponse,
} from "@/lib/trial-e2e/types";

type AuthState = "checking" | "locked" | "authenticated";

interface PublicDescriptor {
  backend: "fixture" | "mindbody_sandbox";
  crmTarget: string;
  mindbodyTarget: string;
  staffAction: string;
  notifications: Record<string, false>;
}

interface SessionResponse {
  ok?: boolean;
  authenticated?: boolean;
  descriptor?: PublicDescriptor;
  error?: string;
}

const DEFAULT_DESCRIPTOR: PublicDescriptor = {
  backend: "fixture",
  crmTarget: "signed deterministic test ledger",
  mindbodyTarget: "deterministic test adapter",
  staffAction: "direct in-browser test action",
  notifications: {},
};

async function responseError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    errors?: unknown;
  };
  const details = Array.isArray(payload.errors)
    ? payload.errors.map(String).join(" · ")
    : typeof payload.error === "string"
      ? payload.error
      : `Request failed (${response.status})`;
  return new Error(details);
}

export default function TrialE2EHarness() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [accessToken, setAccessToken] = useState("");
  const [descriptor, setDescriptor] = useState<PublicDescriptor>(DEFAULT_DESCRIPTOR);
  const [submissionId, setSubmissionId] = useState("");
  const [fixtureClass, setFixtureClass] = useState<TrialClass | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [result, setResult] = useState<TrialE2ERunResponse | null>(null);
  const [idempotencyVerified, setIdempotencyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptFocusRef = useRef<HTMLDivElement>(null);

  const prepareRun = useCallback(async () => {
    setSubmissionId(window.crypto.randomUUID());
    setFixtureClass(null);
    setShowForm(false);
    setResult(null);
    setIdempotencyVerified(false);
    setError(null);

    const response = await fetch("/api/e2e/trial/fixture", { cache: "no-store" });
    if (!response.ok) throw await responseError(response);
    const payload = (await response.json()) as { class?: TrialClass };
    if (!payload.class) throw new Error("The protected test class is unavailable.");
    setFixtureClass(payload.class);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/e2e/session", { cache: "no-store" });
        if (!response.ok) throw await responseError(response);
        const payload = (await response.json()) as SessionResponse;
        if (!active) return;
        if (payload.descriptor) setDescriptor(payload.descriptor);
        if (payload.authenticated) {
          setAuthState("authenticated");
          await prepareRun();
        } else {
          setAuthState("locked");
        }
      } catch (caught) {
        if (!active) return;
        setAuthState("locked");
        setError(caught instanceof Error ? caught.message : "The test lane is unavailable.");
      }
    })();
    return () => {
      active = false;
    };
  }, [prepareRun]);

  const initialValues = useMemo(
    () =>
      submissionId
        ? makeTrialE2EInitialValues(
            submissionId,
            descriptor.backend === "mindbody_sandbox"
              ? "court16-test.invalid"
              : "example.invalid",
          )
        : undefined,
    [descriptor.backend, submissionId],
  );

  useEffect(() => {
    if (!result) return;
    const frame = window.requestAnimationFrame(() => receiptFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/e2e/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      if (!response.ok) throw await responseError(response);
      const payload = (await response.json()) as SessionResponse;
      if (payload.descriptor) setDescriptor(payload.descriptor);
      setAccessToken("");
      setAuthState("authenticated");
      await prepareRun();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock the test lane.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/e2e/session", { method: "DELETE" }).catch(() => undefined);
    setAuthState("locked");
    setSubmissionId("");
    setFixtureClass(null);
    setResult(null);
    setError(null);
  }

  async function submitIntake(request: TrialRequest) {
    setError(null);
    const response = await fetch("/api/e2e/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await responseError(response);
    const payload = (await response.json()) as TrialE2ERunResponse;
    setResult(payload);
    setShowForm(false);
  }

  async function confirmAndVerifyRetry() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const firstResponse = await fetch("/api/e2e/trial/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptToken: result.receiptToken }),
      });
      if (!firstResponse.ok) throw await responseError(firstResponse);
      const first = (await firstResponse.json()) as TrialE2ERunResponse;

      const retryResponse = await fetch("/api/e2e/trial/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptToken: first.receiptToken }),
      });
      if (!retryResponse.ok) throw await responseError(retryResponse);
      const retry = (await retryResponse.json()) as TrialE2ERunResponse;
      if (!retry.cached || retry.status !== "confirmed") {
        throw new Error("Confirmation retry was not returned as cached evidence.");
      }
      setResult(retry);
      setIdempotencyVerified(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test-staff confirmation failed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadReceipt() {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { receipt: result.receipt, receiptToken: result.receiptToken },
          null,
          2,
        ),
      ],
      {
      type: "application/json",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.receipt.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="trial-page-shell">
      <RedesignChrome testMode />
      <main className="c16-container e2e-shell" id="main-content">
        <section className="e2e-hero">
          <div>
            <div className="eyebrow">Protected preview acceptance lane</div>
            <h1>Rehearse the trial workflow. Quietly.</h1>
            <p>
              Run the production family form through an isolated ledger and direct
              test-staff action. Fixture mode checks the UI and contracts; Site -99
              mode additionally rehearses generic Mindbody client, service, enrollment,
              and readback plumbing without a Court 16 production target.
            </p>
          </div>
          {authState === "authenticated" && (
            <button type="button" className="btn ghost" onClick={logout}>
              Lock test lane
            </button>
          )}
        </section>

        <section className="e2e-safety" aria-label="Test isolation guarantees">
          <SafetyItem label="CRM target" value={descriptor.crmTarget} />
          <SafetyItem label="Mindbody target" value={descriptor.mindbodyTarget} />
          <SafetyItem label="Staff action" value={descriptor.staffAction} />
          <SafetyItem label="Notifications" value="Court 16 adapters absent · external delivery not observed" />
        </section>

        {authState === "checking" && (
          <section className="e2e-card" role="status">
            <div className="loading-ball" aria-hidden="true" />
            <h2>Checking the protected test session…</h2>
          </section>
        )}

        {authState === "locked" && (
          <form className="e2e-card e2e-login" onSubmit={unlock}>
            <div className="eyebrow">Access required</div>
            <h2>Unlock the isolated test lane</h2>
            <p>The key is stored only as a Preview environment secret.</p>
            <label>
              Test access key
              <input
                type="password"
                autoComplete="current-password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                required
                minLength={32}
                autoFocus
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Checking…" : "Unlock safe test"} <span aria-hidden="true">→</span>
            </button>
          </form>
        )}

        {authState === "authenticated" && !result && (
          <section className="e2e-card">
            <div className="e2e-step-head">
              <div>
                <div className="eyebrow">Step 1 · Parent experience</div>
                <h2>Choose the isolated fixture class</h2>
                <p>
                  The form opens with synthetic, non-deliverable family data. You can
                  review every field before running intake.
                </p>
              </div>
              <span className={`e2e-mode e2e-mode--${descriptor.backend}`}>
                {descriptor.backend === "mindbody_sandbox" ? "Mindbody Site -99" : "Fixture adapters"}
              </span>
            </div>
            {fixtureClass ? (
              <DayDetail
                classes={[fixtureClass]}
                date={fixtureClass.date}
                interaction={{
                  kind: "select",
                  selectedClassId: showForm ? fixtureClass.classId : null,
                  onPick: () => setShowForm(true),
                }}
              />
            ) : (
              <p role="status">Loading the protected test class…</p>
            )}
          </section>
        )}

        {result && (
          <div
            ref={receiptFocusRef}
            tabIndex={-1}
            className="e2e-receipt-focus"
            aria-labelledby="e2e-receipt-title"
          >
            <ReceiptPanel
              result={result}
              idempotencyVerified={idempotencyVerified}
              busy={busy}
              onConfirm={confirmAndVerifyRetry}
              onDownload={downloadReceipt}
              onReset={() => void prepareRun().catch((caught) => setError(String(caught)))}
            />
          </div>
        )}

        {error && (
          <div className="e2e-error" role="alert">
            <strong>Test stopped safely.</strong> {error}
          </div>
        )}
      </main>

      {showForm && fixtureClass && initialValues && (
        <TrialRequestForm
          submissionId={submissionId}
          trialClass={fixtureClass}
          kids={[]}
          locationId={TRIAL_E2E_LOCATION_ID}
          locationName={TRIAL_E2E_LOCATION_NAME}
          genderOptions={["Female", "Male", "Undisclosed"]}
          initialValues={initialValues}
          testMode
          submissionEnabled
          onSubmit={submitIntake}
          onCancel={() => setShowForm(false)}
        />
      )}

      <style jsx>{`
        .e2e-shell { padding-top: clamp(44px, 6vw, 76px); }
        .e2e-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; margin-bottom: 34px; }
        .e2e-hero h1 { max-width: 840px; margin: 8px 0 14px; font-family: var(--f-display); font-size: clamp(44px, 7vw, 82px); font-weight: 900; letter-spacing: -.04em; line-height: .96; text-wrap: balance; }
        .e2e-hero p { max-width: 800px; margin: 0; color: var(--c16-ink-2); font-size: clamp(16px, 1.7vw, 20px); }
        .e2e-safety { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 2px solid var(--c16-black); background: var(--c16-yellow); box-shadow: 3px 3px 0 var(--c16-black); }
        .e2e-card { margin-top: 28px; padding: clamp(24px, 4vw, 42px); border: 2px solid var(--c16-black); border-radius: var(--r-xl); background: #fff; }
        .e2e-card h2 { margin: 6px 0 10px; font-family: var(--f-display); font-size: clamp(30px, 4vw, 48px); font-weight: 800; line-height: 1; letter-spacing: -.03em; }
        .e2e-card p { color: var(--c16-ink-2); }
        .e2e-login { max-width: 620px; }
        .e2e-login label { display: grid; gap: 7px; margin: 22px 0 14px; font-weight: 800; }
        .e2e-login input { width: 100%; padding: 13px 14px; border: 1.5px solid var(--c16-black); border-radius: var(--r-md); font: inherit; }
        .e2e-step-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 24px; }
        .e2e-mode { flex: none; padding: 8px 12px; border: 1.5px solid var(--c16-black); border-radius: 999px; background: var(--c16-yellow); font-size: 11px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
        .e2e-error { margin-top: 18px; padding: 14px 16px; border: 2px solid #a52834; border-radius: var(--r-md); background: #fff1f1; color: #7d1420; }
        .e2e-receipt-focus:focus { outline: 3px solid var(--c16-yellow); outline-offset: 5px; }
        @media (max-width: 880px) { .e2e-safety { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 640px) { .e2e-hero, .e2e-step-head { flex-direction: column; } .e2e-safety { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function SafetyItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="safety-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <style jsx>{`
        .safety-item { min-height: 96px; padding: 18px; border-right: 1.5px solid var(--c16-black); }
        .safety-item:last-child { border-right: 0; }
        span { display: block; margin-bottom: 6px; font-size: 10px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        strong { display: block; font-size: 14px; line-height: 1.3; }
        @media (max-width: 880px) { .safety-item { border-bottom: 1.5px solid var(--c16-black); } }
      `}</style>
    </div>
  );
}

function ReceiptPanel({
  result,
  idempotencyVerified,
  busy,
  onConfirm,
  onDownload,
  onReset,
}: {
  result: TrialE2ERunResponse;
  idempotencyVerified: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const confirmed = result.status === "confirmed";
  const receipt = result.receipt;
  const notificationAdapterInvocations = [
    receipt.notificationEvidence.hubspotAdapterInvoked,
    receipt.notificationEvidence.staffNotifierInvoked,
    receipt.notificationEvidence.adminNotifierInvoked,
  ].filter(Boolean).length;
  const confirmedTitle =
    receipt.mode === "mindbody_sandbox"
      ? "Sandbox integration rehearsal passed."
      : "UI and contract rehearsal passed.";
  const verificationHeading =
    receipt.mode === "mindbody_sandbox"
      ? "What this sandbox rehearsal verifies"
      : "What this fixture contract simulation checks";
  const completedSummary =
    receipt.mode === "mindbody_sandbox"
      ? "The receipt records the sandbox adapter's service, enrollment, readback, ledger, and cached-retry evidence, along with the boundary it does not prove."
      : "The receipt records simulated service, enrollment, readback, ledger, and cached-retry contracts. It does not claim that production routes or vendors ran.";

  return (
    <section className="receipt-card" aria-live="polite">
      <div className="receipt-hero">
        <div className="receipt-mark" aria-hidden="true">{confirmed ? "✓" : "2"}</div>
        <div>
          <div className="eyebrow">{confirmed ? "Isolated rehearsal completed" : "Step 2 · Test staff"}</div>
          <h2 id="e2e-receipt-title">
            {confirmed ? confirmedTitle : "Intake rehearsal passed. Confirm the class."}
          </h2>
          <p>
            {confirmed
              ? completedSummary
              : "No Court 16 staff action was sent. Use the direct test-staff action to exercise the remaining isolated sequence."}
          </p>
        </div>
      </div>

      <div className="receipt-summary">
        <Summary label="State" value={receipt.state.replace("_", " ")} />
        <Summary label="Court 16 notifiers" value={`${notificationAdapterInvocations} invoked`} />
        <Summary label="Stages passed" value={String(receipt.stages.length)} />
        <Summary label="Retry" value={idempotencyVerified ? "cached · passed" : "not run"} />
      </div>

      <ol className="receipt-stages">
        {receipt.stages.map((entry) => (
          <li key={entry.key}>
            <span className={`stage-dot stage-dot--${entry.status}`} aria-hidden="true">✓</span>
            <div>
              <strong>{entry.label}</strong>
              <p>{entry.evidence}</p>
              <code>{entry.system} · {entry.status}</code>
            </div>
          </li>
        ))}
      </ol>

      <details className="receipt-details">
        <summary>Receipt IDs and verification boundary</summary>
        <dl>
          {Object.entries(receipt.ids).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>
          ))}
        </dl>
        <h3>{verificationHeading}</h3>
        <ul>{receipt.verificationScope.map((item) => <li key={item}>{item}</li>)}</ul>
        <h3>Still outside this receipt</h3>
        <ul>{receipt.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>

      <div className="receipt-actions">
        {!confirmed && (
          <button type="button" className="btn primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Confirming + retrying…" : "Run test-staff confirmation"}
            <span aria-hidden="true">→</span>
          </button>
        )}
        {confirmed && <button type="button" className="btn primary" onClick={onDownload}>Download signed receipt bundle</button>}
        <button type="button" className="btn ghost" onClick={onReset} disabled={busy}>Start another run</button>
      </div>

      <p className="receipt-ref">Run reference: <code>{receipt.runId}</code></p>

      <style jsx>{`
        .receipt-card { margin-top: 28px; padding: clamp(24px, 4vw, 44px); border: 2px solid var(--c16-black); border-radius: var(--r-xl); background: #fff; box-shadow: 4px 4px 0 var(--c16-black); }
        .receipt-hero { display: flex; gap: 20px; align-items: flex-start; }
        .receipt-mark { width: 54px; height: 54px; flex: none; display: grid; place-items: center; border: 2px solid var(--c16-black); border-radius: 50%; background: var(--c16-yellow); font-size: 24px; font-weight: 900; }
        h2 { margin: 6px 0 10px; font-family: var(--f-display); font-size: clamp(34px, 5vw, 62px); font-weight: 900; line-height: .98; letter-spacing: -.04em; }
        .receipt-hero p { max-width: 820px; margin: 0; color: var(--c16-ink-2); font-size: 17px; }
        .receipt-summary { display: grid; grid-template-columns: repeat(4, 1fr); margin: 28px 0; border: 1.5px solid var(--c16-black); }
        .receipt-stages { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--c16-line); }
        .receipt-stages li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--c16-line); }
        .stage-dot { width: 23px; height: 23px; display: grid; place-items: center; border: 1.5px solid var(--c16-black); border-radius: 50%; background: var(--c16-yellow); font-size: 12px; font-weight: 900; }
        .stage-dot--cached { background: #d9f2e3; }
        .receipt-stages strong { font-size: 16px; }
        .receipt-stages p { margin: 4px 0; color: var(--c16-ink-2); font-size: 13px; }
        code { font-family: var(--f-mono); font-size: 11px; }
        .receipt-details { margin-top: 24px; padding: 17px 18px; border: 1.5px solid var(--c16-black); background: var(--c16-paper-2); }
        .receipt-details summary { cursor: pointer; font-weight: 900; }
        .receipt-details dl > div { display: grid; grid-template-columns: 180px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--c16-line); }
        .receipt-details dt { font-weight: 800; }
        .receipt-details dd { margin: 0; overflow-wrap: anywhere; }
        .receipt-details h3 { margin: 20px 0 8px; }
        .receipt-details ul { margin: 0; padding-left: 20px; }
        .receipt-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
        .receipt-ref { margin: 22px 0 0; color: var(--c16-ink-3); font-size: 11px; }
        @media (max-width: 720px) { .receipt-summary { grid-template-columns: 1fr 1fr; } .receipt-details dl > div { grid-template-columns: 1fr; gap: 2px; } }
      `}</style>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary">
      <span>{label}</span><strong>{value}</strong>
      <style jsx>{`
        .summary { padding: 14px; border-right: 1px solid var(--c16-line); }
        span { display: block; margin-bottom: 4px; color: var(--c16-ink-3); font-size: 10px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        strong { font-size: 15px; text-transform: capitalize; }
      `}</style>
    </div>
  );
}
