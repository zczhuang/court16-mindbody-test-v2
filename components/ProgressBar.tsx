"use client";

import React from "react";

export type TrialStep = "location" | "calendar" | "details" | "confirmed";

interface Props {
  step: TrialStep;
}

const STEPS: { k: TrialStep; n: number; label: string }[] = [
  { k: "location", n: 1, label: "Choose a club" },
  { k: "calendar", n: 2, label: "Pick a class" },
  { k: "details", n: 3, label: "Parent details" },
];

export default function ProgressBar({ step }: Props) {
  const idx = STEPS.findIndex((s) => s.k === step);
  const effectiveIdx = step === "confirmed" ? STEPS.length : idx;

  return (
    <div className="c16-progress trial-progress">
      <div className="trial-hero-copy">
        <div className="trial-kicker">Free kids tennis trial</div>
        <h1>Find their first Court 16 class.</h1>
        <p className="prog-lead">
          Pick a club and an age-appropriate class. We&apos;ll check for an existing family,
          create only the profiles that are needed, and have our team confirm the trial.
        </p>
      </div>
      <div className="prog-rail" aria-label="Trial request progress">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.k}>
            <div
              className={`prog-step ${i <= effectiveIdx ? "on" : ""} ${i === effectiveIdx ? "current" : ""}`}
            >
              <span className="prog-dot">{i < effectiveIdx ? "✓" : s.n}</span>
              <span className="prog-lbl">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`prog-line ${i < effectiveIdx ? "on" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
