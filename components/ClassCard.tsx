"use client";

import type { TrialClass } from "@/lib/trial-types";

interface Props {
  trialClass: TrialClass;
  isSelected: boolean;
  onSelect: (tc: TrialClass) => void;
}

export default function ClassCard({ trialClass, isSelected, onSelect }: Props) {
  const spotTone =
    trialClass.spotsAvailable <= 1
      ? "low"
      : trialClass.spotsAvailable <= 3
        ? "mid"
        : "ok";

  return (
    <button
      type="button"
      className={`class-card ${isSelected ? "on" : ""}`}
      onClick={() => onSelect(trialClass)}
    >
      <div className="cc-top">
        <span className="lvl-chip">{trialClass.levelName}</span>
        <span className={`spots-chip spots-${spotTone}`}>
          <span className="dot" /> {trialClass.spotsAvailable}{" "}
          {trialClass.spotsAvailable === 1 ? "spot" : "spots"}
        </span>
      </div>
      <div className="cc-title">{trialClass.name}</div>
      <div className="cc-meta">
        <span className="mono">
          {trialClass.time} – {trialClass.endTime}
        </span>
        <span className="sep">·</span>
        <span>{trialClass.coach}</span>
      </div>
      <div className="cc-go">
        Request this trial
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path
            d="M2 8h11M9 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </button>
  );
}
