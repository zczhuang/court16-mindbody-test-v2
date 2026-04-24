"use client";

import React from "react";

export type TrialStep = "location" | "calendar" | "confirmed";

interface Props {
  step: TrialStep;
}

const STEPS: { k: TrialStep; n: number; label: string }[] = [
  { k: "location", n: 1, label: "Club" },
  { k: "calendar", n: 2, label: "Class" },
];

export default function ProgressBar({ step }: Props) {
  const idx = STEPS.findIndex((s) => s.k === step);
  const effectiveIdx = step === "confirmed" ? STEPS.length : idx;

  return (
    <div className="c16-progress">
      <div className="prog-lead">
        Pick a club, request a class — we&apos;ll confirm within a few hours.
      </div>
      <div className="prog-rail">
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
