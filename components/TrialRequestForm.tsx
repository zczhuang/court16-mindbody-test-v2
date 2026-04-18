"use client";

import { useEffect, useState } from "react";
import type { TrialClass, TrialRequest, ChildInfo } from "@/lib/trial-types";
import type { ChildEntry } from "@/components/AgeSelector";

interface Props {
  trialClass: TrialClass;
  kids: ChildEntry[];
  locationId: string;
  locationName: string;
  onSubmit: (request: TrialRequest) => Promise<void>;
  onCancel: () => void;
}

/**
 * Renders as a centered modal overlay — matches the enrollment tool's
 * "pop up over the calendar" interaction. Backdrop click + Escape key
 * both close.
 */
export default function TrialRequestForm({
  trialClass,
  kids,
  locationId,
  locationName,
  onSubmit,
  onCancel,
}: Props) {
  const [parentFirstName, setParentFirstName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [childNames, setChildNames] = useState<string[]>(kids.map(() => ""));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function setChildName(index: number, name: string) {
    setChildNames((prev) => prev.map((n, i) => (i === index ? name : n)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const children: ChildInfo[] = kids.map((kid, i) => ({
      firstName: childNames[i],
      age: kid.age,
    }));

    try {
      await onSubmit({
        parentFirstName,
        parentEmail,
        parentPhone,
        childFirstName: childNames[0],
        childAge: kids[0].age,
        children,
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
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-form-title"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 sm:p-6 bg-black/60"
      onMouseDown={(e) => {
        // Close when clicking the backdrop, not when clicking inside the card
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 id="trial-form-title" className="font-bold text-lg leading-tight">
              Request This Trial
            </h3>
            <p className="text-xs text-c16-gray-dark mt-1">
              {trialClass.levelName} · {trialClass.dayOfWeek} at {trialClass.time} · {trialClass.coach}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-lg leading-none text-c16-gray-dark"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-c16-gray-dark mb-1">
                Your first name *
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={parentFirstName}
                onChange={(e) => setParentFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-c16-yellow"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-c16-gray-dark mb-1">
                Your email *
              </label>
              <input
                type="email"
                required
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-c16-yellow"
                placeholder="you@email.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-c16-gray-dark mb-1">
              Mobile phone *
            </label>
            <input
              type="tel"
              required
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-c16-yellow"
              placeholder="(212) 555-0100"
            />
            <p className="text-[11px] text-c16-gray-dark mt-1">
              Staff calls to confirm your trial within a few hours.
            </p>
          </div>

          {kids.map((kid, i) => (
            <div key={i}>
              <label className="block text-xs font-semibold text-c16-gray-dark mb-1">
                {kids.length === 1
                  ? "Child\u2019s first name *"
                  : `${kid.label}\u2019s first name (age ${kid.age}) *`}
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={childNames[i]}
                onChange={(e) => setChildName(i, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-c16-yellow"
                placeholder={kids.length === 1 ? "Child\u2019s name" : `${kid.label}\u2019s name`}
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-semibold text-c16-gray-dark mb-1">
              Anything we should know? (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-c16-yellow resize-none"
              placeholder="Allergies, experience level, special requests..."
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            &larr; Back
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 px-4 py-3 bg-c16-black text-white rounded-xl font-semibold text-sm hover:bg-c16-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending..." : "Request This Trial \u2192"}
          </button>
        </div>
      </div>
    </div>
  );
}
