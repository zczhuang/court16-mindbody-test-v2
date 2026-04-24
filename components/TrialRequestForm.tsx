"use client";

import { useEffect, useState } from "react";
import type { TrialClass, TrialRequest } from "@/lib/trial-types";
import type { ChildEntry } from "@/components/AgeSelector";

interface Props {
  trialClass: TrialClass;
  kids: ChildEntry[];
  locationId: string;
  locationName: string;
  onSubmit: (request: TrialRequest) => Promise<void>;
  onCancel: () => void;
}

const AGE_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 3); // 3-17

export default function TrialRequestForm({
  trialClass,
  locationId,
  locationName,
  onSubmit,
  onCancel,
}: Props) {
  const [parentFirstName, setParentFirstName] = useState("");
  const [parentLastName, setParentLastName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentBirthDate, setParentBirthDate] = useState("");
  const [childFirstName, setChildFirstName] = useState("");
  const [childAge, setChildAge] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (childAge === "") {
      setError("Child's age is required.");
      return;
    }
    setSubmitting(true);

    try {
      await onSubmit({
        parentFirstName,
        parentLastName,
        parentEmail,
        parentPhone,
        parentBirthDate: parentBirthDate || undefined,
        childFirstName,
        childAge: Number(childAge),
        children: [{ firstName: childFirstName, age: Number(childAge) }],
        locationId,
        locationName,
        classScheduleId: trialClass.classScheduleId,
        className: trialClass.name,
        classDay: `${trialClass.dayOfWeek}, ${trialClass.date}`,
        classTime: trialClass.time,
        coachName: trialClass.coach,
        notes: notes || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-form-title"
      className="trf-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="trf-card">
        <div className="trf-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Request this trial
            </div>
            <h3 id="trial-form-title" className="trf-title">
              {trialClass.name}
            </h3>
            <div className="trf-meta">
              <span className="mono">
                {trialClass.dayOfWeek}, {trialClass.time}
              </span>
              <span className="sep">·</span>
              <span>{trialClass.coach}</span>
              <span className="sep">·</span>
              <span>{locationName}</span>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="trf-close"
            type="button"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="trf-body">
          <div className="trf-section">
            <div className="eyebrow">Parent</div>
            <div className="trf-grid">
              <Field label="First name *">
                <input
                  type="text"
                  required
                  value={parentFirstName}
                  onChange={(e) => setParentFirstName(e.target.value)}
                  placeholder="First name"
                  className="trf-input"
                />
              </Field>
              <Field label="Last name *">
                <input
                  type="text"
                  required
                  value={parentLastName}
                  onChange={(e) => setParentLastName(e.target.value)}
                  placeholder="Last name"
                  className="trf-input"
                />
              </Field>
            </div>
            <Field label="Email *">
              <input
                type="email"
                required
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                placeholder="you@email.com"
                className="trf-input"
              />
            </Field>
            <div className="trf-grid">
              <Field label="Mobile phone *" hint="Staff calls to confirm within a few hours.">
                <input
                  type="tel"
                  required
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  placeholder="(212) 555-0100"
                  className="trf-input"
                />
              </Field>
              <Field label="Your date of birth (optional)" hint="Keeps your MindBody account clean.">
                <input
                  type="date"
                  value={parentBirthDate}
                  onChange={(e) => setParentBirthDate(e.target.value)}
                  className="trf-input"
                />
              </Field>
            </div>
          </div>

          <div className="trf-section">
            <div className="eyebrow">Child</div>
            <div className="trf-grid">
              <Field label="First name *">
                <input
                  type="text"
                  required
                  value={childFirstName}
                  onChange={(e) => setChildFirstName(e.target.value)}
                  placeholder="Child's first name"
                  className="trf-input"
                />
              </Field>
              <Field label="Age *">
                <select
                  required
                  value={childAge === "" ? "" : String(childAge)}
                  onChange={(e) =>
                    setChildAge(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="trf-input"
                >
                  <option value="" disabled>
                    Select age…
                  </option>
                  {AGE_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      Age {a}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Anything we should know? (optional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Allergies, experience level, special requests…"
                className="trf-input"
                style={{ resize: "vertical", minHeight: 60 }}
              />
            </Field>
          </div>

          {error && <div className="trf-error">{error}</div>}
        </form>

        <div className="trf-foot">
          <button type="button" onClick={onCancel} className="btn ghost">
            ← Back
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn primary"
          >
            {submitting ? "Sending…" : "Request this trial"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                d="M2 8h11M9 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <style jsx>{`
        .trf-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 24px;
          background: color-mix(in oklab, var(--c16-ink), transparent 40%);
          backdrop-filter: blur(4px);
          overflow-y: auto;
        }
        @media (min-width: 640px) {
          .trf-backdrop {
            align-items: center;
          }
        }
        .trf-card {
          width: 100%;
          max-width: 560px;
          background: var(--c16-paper);
          border: 2px solid var(--c16-black);
          border-radius: var(--r-2xl);
          box-shadow: var(--shadow-pop);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: calc(100vh - 48px);
        }
        .trf-head {
          padding: 22px 22px 16px;
          border-bottom: 1px solid var(--c16-line);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          background: #fff;
        }
        .trf-title {
          font-family: var(--f-display);
          font-weight: 700;
          font-size: 22px;
          line-height: 1.2;
          letter-spacing: -0.03em;
          margin: 0 0 6px;
          color: var(--c16-black);
          text-wrap: balance;
        }
        .trf-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 13px;
          color: var(--c16-ink-2);
        }
        .trf-meta .sep {
          color: var(--c16-ink-4);
        }
        .trf-meta .mono {
          font-family: var(--f-mono);
          font-weight: 600;
        }
        .trf-close {
          width: 32px;
          height: 32px;
          border-radius: 999px;
          border: 0;
          background: transparent;
          color: var(--c16-ink-3);
          font-size: 22px;
          line-height: 1;
          display: grid;
          place-items: center;
        }
        .trf-close:hover {
          background: var(--c16-paper-2);
          color: var(--c16-black);
        }
        .trf-body {
          padding: 18px 22px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .trf-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trf-section .eyebrow {
          margin-bottom: 2px;
        }
        .trf-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        @media (min-width: 520px) {
          .trf-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        .trf-input {
          width: 100%;
          padding: 11px 14px;
          font-size: 14px;
          font-family: var(--f-sans);
          font-weight: 500;
          color: var(--c16-black);
          background: #fff;
          border: 1.5px solid var(--c16-line);
          border-radius: var(--r-md);
          outline: none;
          transition: border-color 0.12s ease, box-shadow 0.12s ease;
        }
        .trf-input:focus {
          border-color: var(--c16-black);
          box-shadow: 0 0 0 3px var(--c16-yellow);
        }
        .trf-error {
          padding: 10px 12px;
          background: var(--c16-red-soft);
          color: var(--c16-red);
          border-radius: var(--r-md);
          font-size: 13px;
          font-weight: 600;
        }
        .trf-foot {
          padding: 14px 22px;
          border-top: 1px solid var(--c16-line);
          background: var(--c16-paper-2);
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: 4,
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--c16-ink-3)",
        fontWeight: 600,
        fontFamily: "var(--f-mono)",
      }}
    >
      {label}
      {children}
      {hint && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "var(--c16-ink-3)",
            fontFamily: "var(--f-sans)",
            letterSpacing: "0",
            textTransform: "none",
            marginTop: 2,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}
