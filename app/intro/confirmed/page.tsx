"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";

type ConfirmState =
  | "checking"
  | "confirmed"
  | "manual_review"
  | "softwall"
  | "failed";

interface ConfirmResult {
  state: ConfirmState;
  correlationId: string;
  message?: string;
}

function ConfirmedInner() {
  const params = useSearchParams();
  const correlationId = params.get("correlationId");
  const preState = params.get("status");
  const [result, setResult] = useState<ConfirmResult>({
    state:
      preState === "softwall"
        ? "softwall"
        : correlationId
          ? "checking"
          : "failed",
    correlationId: correlationId ?? "unknown",
    message:
      preState === "softwall"
        ? "We already have an account for this email."
        : !correlationId
          ? "Missing correlation ID — can't look up your booking."
          : undefined,
  });

  useEffect(() => {
    if (!correlationId || result.state !== "checking") return;
    let cancelled = false;
    const controller = new AbortController();

    async function confirm() {
      try {
        const resp = await fetch("/api/book/intro/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correlationId }),
          signal: controller.signal,
        });
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setResult({
            state: "failed",
            correlationId: correlationId!,
            message:
              typeof data.error === "string"
                ? data.error
                : `HTTP ${resp.status}`,
          });
          return;
        }
        const next: ConfirmState =
          data.status === "confirmed"
            ? "confirmed"
            : data.status === "manual_review"
              ? "manual_review"
              : "failed";
        setResult({ state: next, correlationId: correlationId! });
      } catch (err) {
        if (cancelled) return;
        setResult({
          state: "failed",
          correlationId: correlationId!,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    confirm();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [correlationId, result.state]);

  return (
    <>
      <Header />
      <div className="c16-container" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div className="section-head" style={{ textAlign: "center" }}>
          <div className="eyebrow">Your intro booking</div>
          {result.state === "confirmed" && (
            <h1 className="section-title">
              You&apos;re <em>in</em>.
            </h1>
          )}
          {result.state === "checking" && (
            <h1 className="section-title">Confirming your payment…</h1>
          )}
          {result.state === "manual_review" && (
            <h1 className="section-title">Almost there</h1>
          )}
          {result.state === "softwall" && (
            <h1 className="section-title">We see you</h1>
          )}
          {result.state === "failed" && (
            <h1 className="section-title">
              Something <em>went wrong</em>
            </h1>
          )}
          <p className="section-sub">{copyFor(result)}</p>
        </div>

        <div
          style={{
            maxWidth: 520,
            margin: "24px auto 0",
            background: "#fff",
            border: "1.5px solid var(--c16-line)",
            borderRadius: "var(--r-xl)",
            padding: "18px 22px",
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Reference
          </div>
          <code
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 13,
              color: "var(--c16-black)",
            }}
          >
            {result.correlationId}
          </code>
          {result.message && (
            <p
              style={{
                marginTop: 10,
                color: "var(--c16-ink-3)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {result.message}
            </p>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 36 }}>
          <Link href="/" className="btn ghost">
            Back to Court 16
          </Link>
        </div>
      </div>
    </>
  );
}

export default function IntroConfirmedPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmedInner />
    </Suspense>
  );
}

function copyFor(result: ConfirmResult): string {
  switch (result.state) {
    case "checking":
      return "Verifying your payment with MindBody…";
    case "confirmed":
      return "Your class is booked. Check your inbox for details — and bring water.";
    case "manual_review":
      return "Payment went through but your booking needs a manual check. Court 16 staff will email you within a few hours.";
    case "softwall":
      return "Looks like you already have a Court 16 account. Staff will reach out within 24 hours to finalize your intro.";
    case "failed":
      return "Please email info@court16.com with your reference ID and we'll sort it out.";
  }
}
