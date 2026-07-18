"use client";

import React from "react";

export type TrialStep = "location" | "calendar" | "details" | "confirmed";

interface Props {
  step: TrialStep;
}

const STEPS: { k: TrialStep; n: number; label: string }[] = [
  { k: "location", n: 1, label: "Choose a club" },
  { k: "calendar", n: 2, label: "Pick a class" },
  { k: "details", n: 3, label: "Family details" },
];

export default function ProgressBar({ step }: Props) {
  const idx = STEPS.findIndex((s) => s.k === step);
  const effectiveIdx = step === "confirmed" ? STEPS.length : idx;

  return (
    <div className="c16-progress trial-progress">
      <div className="trial-hero-copy">
        <div className="trial-kicker">Free kids tennis trial</div>
        <h1>Book Your Kids Tennis Trial</h1>
        <p className="prog-lead">
          Choose a club and an age-appropriate trial time. It&apos;s free, we provide the
          racquet, and our team will confirm the spot.
        </p>
      </div>
      <nav className="prog-rail" aria-label="Trial request progress">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.k}>
            <div
              className={`prog-step ${i <= effectiveIdx ? "on" : ""} ${i === effectiveIdx ? "current" : ""}`}
              aria-current={i === effectiveIdx ? "step" : undefined}
            >
              <span className="prog-dot">{i < effectiveIdx ? "✓" : s.n}</span>
              <span className="prog-lbl">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`prog-line ${i < effectiveIdx ? "on" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </nav>
    </div>
  );
}
