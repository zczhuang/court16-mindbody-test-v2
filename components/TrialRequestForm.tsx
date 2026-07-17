"use client";

import { useEffect, useState } from "react";
import type { TrialClass, TrialRequest } from "@/lib/trial-types";
import type { ChildEntry } from "@/components/AgeSelector";
import { ageFromDob } from "@/lib/class-utils";

interface Props {
  trialClass: TrialClass;
  kids: ChildEntry[];
  locationId: string;
  locationName: string;
  onSubmit: (request: TrialRequest) => Promise<void>;
  onCancel: () => void;
}

const MIN_TRIAL_AGE = 3;
const MAX_TRIAL_AGE = 17;

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
  const [childLastName, setChildLastName] = useState("");
  const [childBirthDate, setChildBirthDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const derivedAge = childBirthDate ? ageFromDob(childBirthDate) : NaN;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!childBirthDate || Number.isNaN(derivedAge)) {
      setError("Child's date of birth is required.");
      return;
    }
    if (derivedAge < MIN_TRIAL_AGE || derivedAge > MAX_TRIAL_AGE) {
      setError(
        `Trials are for kids ages ${MIN_TRIAL_AGE}–${MAX_TRIAL_AGE} (this date of birth makes your child ${derivedAge}).`,
      );
      return;
    }
    setSubmitting(true);

    try {
      await onSubmit({
        parentFirstName,
        parentLastName,
        parentEmail,
        parentPhone,
        parentBirthDate,
        childFirstName,
        childLastName,
        childAge: derivedAge,
        childBirthDate,
        children: [
          {
            firstName: childFirstName,
            lastName: childLastName,
            age: derivedAge,
            birthDate: childBirthDate,
          },
        ],
        locationId,
        locationName,
        classScheduleId: trialClass.classScheduleId,
        classId: trialClass.classId,
        className: trialClass.name,
        classDay: `${trialClass.dayOfWeek}, ${trialClass.date}`,
        classTime: trialClass.time,
        classStartsAt: trialClass.startsAt,
        coachName: trialClass.coach,
        notes: notes || undefined,
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't send the trial request. Please try again, or call 718-875-5550 and we'll help.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-form-title"
      aria-busy={submitting}
      className="trf-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="trf-card">
        <div className="trf-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Step 3 of 3 · Parent details
            </div>
            <h3 id="trial-form-title" className="trf-title">
              Tell us about your player.
            </h3>
            <div className="trf-meta">
              <strong>{trialClass.name}</strong>
              <span className="sep">·</span>
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
            disabled={submitting}
          >
            ×
          </button>
        </div>

        <form id="trial-request-form" onSubmit={handleSubmit} className="trf-body">
          <div className="trf-account-note">
            <strong>We skip the 11-step Mindbody signup.</strong>
            <span>
              If we do not find an existing family record that needs review, this request
              creates the parent and child profiles. Mindbody may then email the parent a
              secure link to claim the parent account.
            </span>
          </div>
          <div className="trf-section">
            <div className="eyebrow">Parent or guardian</div>
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
            <Field
              label="Email *"
              hint="If a new parent account is created, Mindbody sends the account-claim email here."
            >
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
              <Field label="Your date of birth *" hint="Required to create the parent Mindbody profile.">
                <input
                  type="date"
                  required
                  value={parentBirthDate}
                  onChange={(e) => setParentBirthDate(e.target.value)}
                  className="trf-input"
                />
              </Field>
            </div>
          </div>

          <div className="trf-section">
            <div className="eyebrow">Child · no separate login</div>
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
              <Field label="Last name *">
                <input
                  type="text"
                  required
                  value={childLastName}
                  onChange={(e) => setChildLastName(e.target.value)}
                  placeholder="Child's last name"
                  className="trf-input"
                />
              </Field>
            </div>
            <Field
              label="Child's date of birth *"
              hint={
                !Number.isNaN(derivedAge)
                  ? `Age ${derivedAge} — we'll match the right class level.`
                  : "Used for age matching and the child's Mindbody profile."
              }
            >
              <input
                type="date"
                required
                value={childBirthDate}
                onChange={(e) => setChildBirthDate(e.target.value)}
                className="trf-input"
              />
            </Field>
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
            <div className="trf-family-note">
              Use the same parent email for the family. Your child does not need a password.
              Court 16 staff can help link the existing child profile after you claim the
              parent account.
            </div>
          </div>

          {error && <div className="trf-error">{error}</div>}
        </form>

        <div className="trf-foot">
          <button type="button" onClick={onCancel} className="btn ghost" disabled={submitting}>
            ← Back
          </button>
          <button
            type="submit"
            form="trial-request-form"
            disabled={submitting}
            className="btn primary"
          >
            {submitting ? "Sending…" : "Send trial request"}
            <span aria-hidden="true">→</span>
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
          max-width: 680px;
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
          padding: 24px 26px 20px;
          border-bottom: 2px solid var(--c16-black);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          background: var(--c16-yellow);
        }
        .trf-title {
          font-family: var(--f-display);
          font-weight: 700;
          font-size: 30px;
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
        .trf-close:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .trf-body {
          padding: 22px 26px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .trf-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px;
          border: 1px solid var(--c16-line);
          background: #fff;
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
          border: 1.5px solid #bdbdb4;
          border-radius: 8px;
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
        .trf-account-note,
        .trf-family-note {
          display: grid;
          gap: 4px;
          padding: 14px 16px;
          border: 1.5px solid var(--c16-black);
          background: var(--c16-yellow-soft);
          font-size: 13px;
          line-height: 1.45;
        }
        .trf-account-note strong {
          font-family: var(--f-display);
          font-size: 16px;
        }
        .trf-family-note {
          border-color: var(--c16-line);
          background: var(--c16-paper-2);
          color: var(--c16-ink-2);
        }
        .trf-foot {
          padding: 16px 26px;
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
