"use client";

import { useEffect, useRef, useState } from "react";
import type { TrialClass, TrialRequest } from "@/lib/trial-types";
import type { ChildEntry } from "@/components/AgeSelector";
import { ageFromDob } from "@/lib/class-utils";
import {
  MAX_KIDS_TRIAL_AGE,
  MIN_KIDS_TRIAL_AGE,
  US_STATE_AND_TERRITORY_CODES,
  isValidIsoDate,
  type MindbodyStandardGender,
} from "@/lib/trial-intake";
import {
  CHILD_PLAYING_LEVELS,
  LEAD_SOURCES,
  type ChildPlayingLevel,
  type LeadSource,
} from "@/lib/trial-reporting";

interface Props {
  submissionId: string;
  trialClass: TrialClass;
  kids: ChildEntry[];
  locationId: string;
  locationName: string;
  genderOptions: readonly MindbodyStandardGender[];
  onSubmit: (request: TrialRequest) => Promise<void>;
  onCancel: () => void;
}

type FormStep = "family" | "mindbody";

const TRIAL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function TrialRequestForm({
  submissionId,
  trialClass,
  locationId,
  locationName,
  genderOptions,
  onSubmit,
  onCancel,
}: Props) {
  const [parentFirstName, setParentFirstName] = useState("");
  const [parentLastName, setParentLastName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentBirthDate, setParentBirthDate] = useState("");
  const [parentGender, setParentGender] = useState<MindbodyStandardGender | "">("");
  const [childFirstName, setChildFirstName] = useState("");
  const [childLastName, setChildLastName] = useState("");
  const [childBirthDate, setChildBirthDate] = useState("");
  const [childGender, setChildGender] = useState<MindbodyStandardGender | "">("");
  const [childPlayingLevel, setChildPlayingLevel] = useState<ChildPlayingLevel | "">("");
  const [childSchool, setChildSchool] = useState("");
  const [leadSource, setLeadSource] = useState<LeadSource | "">("");
  const [householdAddress1, setHouseholdAddress1] = useState("");
  const [householdAddress2, setHouseholdAddress2] = useState("");
  const [householdCity, setHouseholdCity] = useState("");
  const [householdState, setHouseholdState] = useState("");
  const [householdPostalCode, setHouseholdPostalCode] = useState("");
  const [notes, setNotes] = useState("");
  const [formStep, setFormStep] = useState<FormStep>("family");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogCardRef = useRef<HTMLDivElement>(null);
  const formBodyRef = useRef<HTMLFormElement>(null);
  const formTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        dialogCardRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && activeIndex <= 0) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeIndex === -1 || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    // Each panel has a different height. Reset the internal scroll position
    // and announce the new heading so keyboard and screen-reader users land
    // at the start instead of inheriting the prior panel's scroll offset.
    formBodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
    formTitleRef.current?.focus({ preventScroll: true });
  }, [formStep]);

  const derivedAge = childBirthDate ? ageFromDob(childBirthDate) : NaN;
  const trialDateLabel = TRIAL_DATE_FORMATTER.format(
    new Date(`${trialClass.date}T00:00:00`),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Revalidate the first panel in React as well as with native form
    // constraints. Those inputs are unmounted on panel two, so a server
    // response must not be the first time the family learns one is invalid.
    if (!parentFirstName.trim() || !parentLastName.trim()) {
      setError("Enter the parent or guardian's first and last name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(parentEmail.trim())) {
      setError("Enter a valid parent or guardian email address.");
      return;
    }
    if (parentPhone.replace(/\D/g, "").length < 7) {
      setError("Enter a valid parent or guardian mobile phone number.");
      return;
    }
    if (!isValidIsoDate(parentBirthDate) || ageFromDob(parentBirthDate) < 18) {
      setError("Enter the date of birth of an adult parent or guardian (18+).");
      return;
    }
    if (!childFirstName.trim() || !childLastName.trim()) {
      setError("Enter the child's first and last name.");
      return;
    }
    if (!isValidIsoDate(childBirthDate) || Number.isNaN(derivedAge)) {
      setError("Child's date of birth is required.");
      return;
    }
    if (derivedAge < MIN_KIDS_TRIAL_AGE || derivedAge > MAX_KIDS_TRIAL_AGE) {
      setError(
        `Trials are for kids ages ${MIN_KIDS_TRIAL_AGE}–${MAX_KIDS_TRIAL_AGE} (this date of birth makes your child ${derivedAge}).`,
      );
      return;
    }
    if (!childPlayingLevel || !leadSource) {
      setError("Select the child's tennis experience and how you heard about Court 16.");
      return;
    }
    if (formStep === "family") {
      setFormStep("mindbody");
      return;
    }
    if (!parentGender || !childGender) {
      setError("Select the required gender field for both the parent and child.");
      return;
    }
    setSubmitting(true);

    try {
      await onSubmit({
        submissionId,
        parentFirstName,
        parentLastName,
        parentEmail,
        parentPhone,
        parentBirthDate,
        parentGender,
        childFirstName,
        childLastName,
        childAge: derivedAge,
        childBirthDate,
        childGender,
        childPlayingLevel,
        childSchool: childSchool || undefined,
        leadSource,
        householdAddress1,
        householdAddress2: householdAddress2 || undefined,
        householdCity,
        householdState,
        householdPostalCode,
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
      <div ref={dialogCardRef} className="trf-card">
        <div className="trf-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Final details · {formStep === "family" ? "1 of 2" : "2 of 2"}
            </div>
            <h3
              ref={formTitleRef}
              id="trial-form-title"
              className="trf-title"
              tabIndex={-1}
            >
              {formStep === "family"
                ? "Tell us about your player."
                : "Finish your family details."}
            </h3>
            <div className="trf-meta">
              <strong>{trialClass.name}</strong>
              <span className="sep">·</span>
              <span className="mono">{trialDateLabel} at {trialClass.time}</span>
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

        <form
          ref={formBodyRef}
          id="trial-request-form"
          onSubmit={handleSubmit}
          className="trf-body"
        >
          {formStep === "family" ? (
            <>
              <div className="trf-account-note">
                <strong>One quick form. We&apos;ll handle the setup.</strong>
                <span>
                  No credit card is needed. We&apos;ll use these details to prepare the
                  family records, and Mindbody will send any secure account email.
                </span>
              </div>
              <div className="trf-section">
                <div className="eyebrow">Parent or guardian</div>
                <div className="trf-grid">
                  <Field label="First name *">
                    <input
                      type="text"
                      required
                      autoComplete="given-name"
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
                      autoComplete="family-name"
                      value={parentLastName}
                      onChange={(e) => setParentLastName(e.target.value)}
                      placeholder="Last name"
                      className="trf-input"
                    />
                  </Field>
                </div>
                <Field
                  label="Email *"
                  hint="We'll send trial updates here. Mindbody may also send a secure account email."
                >
                  <input
                    type="email"
                    required
                    autoComplete="email"
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
                      autoComplete="tel"
                      value={parentPhone}
                      onChange={(e) => setParentPhone(e.target.value)}
                      placeholder="(212) 555-0100"
                      className="trf-input"
                    />
                  </Field>
                  <Field label="Your date of birth *" hint="Needed to prepare the family account.">
                    <input
                      type="date"
                      required
                      autoComplete="bday"
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
                      : "Used to match the right class."
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
                <div className="trf-grid">
                  <Field label="Tennis experience *">
                    <select
                      required
                      value={childPlayingLevel}
                      onChange={(event) =>
                        setChildPlayingLevel(event.target.value as ChildPlayingLevel)
                      }
                      className="trf-input"
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {CHILD_PLAYING_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="School (optional)">
                    <input
                      type="text"
                      value={childSchool}
                      onChange={(e) => setChildSchool(e.target.value)}
                      className="trf-input"
                    />
                  </Field>
                </div>
                <Field label="How did you hear about Court 16? *">
                  <select
                    required
                    value={leadSource}
                    onChange={(event) => setLeadSource(event.target.value as LeadSource)}
                    className="trf-input"
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    {LEAD_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
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
                  Your child shares the parent contact email and never needs a separate
                  login. Court 16 staff will help with any final family-account link.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="trf-account-note">
                <strong>Keep the family profile accurate.</strong>
                <span>
                  Mindbody asks for the details below when a new account is prepared. We
                  use the household address for both parent and child and protect it under
                  Court 16&apos;s Privacy Policy.
                </span>
              </div>

              <div className="trf-section">
                <div className="eyebrow">Profile details</div>
                <div className="trf-grid">
                  <Field
                    label="Parent or guardian gender *"
                    hint="Required by Mindbody for this club."
                  >
                    <select
                      required
                      value={parentGender}
                      onChange={(event) =>
                        setParentGender(event.target.value as MindbodyStandardGender)
                      }
                      className="trf-input"
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {genderOptions.map((gender) => (
                        <option key={gender} value={gender}>
                          {gender}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Child gender *"
                    hint="Required by Mindbody for this club."
                  >
                    <select
                      required
                      value={childGender}
                      onChange={(event) =>
                        setChildGender(event.target.value as MindbodyStandardGender)
                      }
                      className="trf-input"
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {genderOptions.map((gender) => (
                        <option key={gender} value={gender}>
                          {gender}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              <div className="trf-section">
                <div className="eyebrow">Household address</div>
                <Field label="Street address *">
                  <input
                    type="text"
                    required
                    autoComplete="address-line1"
                    value={householdAddress1}
                    onChange={(e) => setHouseholdAddress1(e.target.value)}
                    placeholder="123 Main Street"
                    className="trf-input"
                  />
                </Field>
                <Field label="Apartment, suite, etc. (optional)">
                  <input
                    type="text"
                    autoComplete="address-line2"
                    value={householdAddress2}
                    onChange={(e) => setHouseholdAddress2(e.target.value)}
                    placeholder="Apt 4B"
                    className="trf-input"
                  />
                </Field>
                <div className="trf-address-grid">
                  <Field label="City *">
                    <input
                      type="text"
                      required
                      autoComplete="address-level2"
                      value={householdCity}
                      onChange={(e) => setHouseholdCity(e.target.value)}
                      className="trf-input"
                    />
                  </Field>
                  <Field label="State *">
                    <select
                      required
                      autoComplete="address-level1"
                      value={householdState}
                      onChange={(event) => setHouseholdState(event.target.value)}
                      className="trf-input"
                    >
                      <option value="" disabled>
                        Select
                      </option>
                      {US_STATE_AND_TERRITORY_CODES.map((stateCode) => (
                        <option key={stateCode} value={stateCode}>
                          {stateCode}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ZIP code *">
                    <input
                      type="text"
                      required
                      autoComplete="postal-code"
                      inputMode="numeric"
                      pattern="[0-9]{5}(-[0-9]{4})?"
                      value={householdPostalCode}
                      onChange={(e) => setHouseholdPostalCode(e.target.value)}
                      placeholder="10001"
                      className="trf-input"
                    />
                  </Field>
                </div>
              </div>

            </>
          )}

          <p className="trf-privacy">
            By sending this request, you agree Court 16 may use these details to arrange
            the trial and prepare linked Mindbody records. See our{" "}
            <a href="https://www.court16.com/terms/privacy-policy">Privacy Policy</a> and{" "}
            <a href="https://www.court16.com/terms/terms-of-use">Terms of Use</a>.
          </p>

          {error && (
            <div className="trf-error" role="alert">
              {error}
            </div>
          )}
        </form>

        <div className="trf-foot">
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (formStep === "mindbody") setFormStep("family");
              else onCancel();
            }}
            className="btn ghost"
            disabled={submitting}
          >
            ← {formStep === "mindbody" ? "Player details" : "Back"}
          </button>
          <button
            type="submit"
            form="trial-request-form"
            disabled={submitting}
            className="btn primary"
          >
            {submitting
              ? "Sending…"
              : formStep === "family"
                ? "Continue"
                : "Send trial request"}
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
          padding: max(12px, env(safe-area-inset-top))
            max(12px, env(safe-area-inset-right))
            max(12px, env(safe-area-inset-bottom))
            max(12px, env(safe-area-inset-left));
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
          max-height: calc(100vh - 24px);
          max-height: calc(100dvh - 24px);
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
        .trf-address-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 10px;
        }
        @media (min-width: 520px) {
          .trf-address-grid {
            grid-template-columns: minmax(0, 2fr) minmax(76px, 0.7fr) minmax(110px, 1fr);
          }
        }
        @media (min-width: 520px) {
          .trf-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        .trf-input {
          width: 100%;
          min-height: 44px;
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
        .trf-privacy {
          margin: 0;
          color: var(--c16-ink-3);
          font-size: 11px;
          line-height: 1.55;
        }
        .trf-privacy a {
          color: var(--c16-black);
          font-weight: 700;
          text-decoration: underline;
          text-decoration-color: var(--c16-yellow);
          text-underline-offset: 3px;
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
          padding: 16px 26px max(16px, env(safe-area-inset-bottom));
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
