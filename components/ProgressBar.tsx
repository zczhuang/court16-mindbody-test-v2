"use client";

import React from "react";
import type { KidsTrialCalendarPreviewScope } from "@/config/kids-trial-readiness";

export type TrialStep = "location" | "calendar" | "details" | "confirmed";

interface Props {
  step: TrialStep;
  previewScope?: KidsTrialCalendarPreviewScope | null;
}

const BOOKING_STEPS: { k: TrialStep; n: number; label: string }[] = [
  { k: "location", n: 1, label: "Choose a club" },
  { k: "calendar", n: 2, label: "Pick a class" },
  { k: "details", n: 3, label: "Family details" },
];

const PREVIEW_STEPS: typeof BOOKING_STEPS = [
  { k: "location", n: 1, label: "Choose a club" },
  { k: "calendar", n: 2, label: "Pick a class" },
  { k: "details", n: 3, label: "Preview the form" },
];

export default function ProgressBar({ step, previewScope }: Props) {
  const steps = previewScope ? PREVIEW_STEPS : BOOKING_STEPS;
  const idx = steps.findIndex((s) => s.k === step);
  const effectiveIdx = step === "confirmed" ? steps.length : idx;
  const kidsSchedule = previewScope === "kids_schedule";

  return (
    <div className="c16-progress trial-progress">
      <div className="trial-hero-copy">
        <div className="trial-kicker">
          {previewScope
            ? kidsSchedule
              ? "Kids tennis schedule"
              : "Kids trial calendar"
            : "Free kids tennis trial"}
        </div>
        <h1>
          {previewScope
            ? kidsSchedule
              ? "Explore Kids Tennis at Court 16"
              : "Preview Kids Trial Times"
            : "Book Your Kids Tennis Trial"}
        </h1>
        <p className="prog-lead">
          {previewScope
            ? kidsSchedule
              ? "Browse the club's current kids schedule and preview the full request form. Final submission stays locked until dedicated trial inventory and launch checks are verified."
              : "Browse the dedicated trial calendar and preview the full request form. Final submission stays locked until booking setup and launch checks are verified."
            : "Choose a club and an age-appropriate trial time. It's free, we provide the racquet, and our team will confirm the spot."}
        </p>
      </div>
      <nav
        className="prog-rail"
        aria-label={previewScope ? "Calendar preview progress" : "Trial request progress"}
      >
        {steps.map((s, i) => (
          <React.Fragment key={s.k}>
            <div
              className={`prog-step ${i <= effectiveIdx ? "on" : ""} ${i === effectiveIdx ? "current" : ""}`}
              aria-current={i === effectiveIdx ? "step" : undefined}
            >
              <span className="prog-dot">
                {i < effectiveIdx ? (
                  // Inline check: Gilroy has no ✓ glyph, and a fallback-font
                  // checkmark renders inconsistently across platforms.
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path
                      d="M2 6.2 L4.8 9 L10 3.4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  s.n
                )}
              </span>
              <span className="prog-lbl">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`prog-line ${i < effectiveIdx ? "on" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </nav>
    </div>
  );
}
