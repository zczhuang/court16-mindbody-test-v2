"use client";

import type { TrialClass } from "@/lib/trial-types";
import type { KidsTrialCalendarPreviewScope } from "@/config/kids-trial-readiness";

interface Props {
  trialClass: TrialClass;
  interaction:
    | {
        kind: "select";
        isSelected: boolean;
        onSelect: (tc: TrialClass) => void;
      }
    | {
        kind: "preview";
        scope: KidsTrialCalendarPreviewScope;
        isSelected: boolean;
        onSelect: (tc: TrialClass) => void;
      };
}

export default function ClassCard({ trialClass, interaction }: Props) {
  const spotTone =
    trialClass.spotsAvailable <= 1
      ? "low"
      : trialClass.spotsAvailable <= 3
        ? "mid"
        : "ok";
  const showCapacity = interaction.kind === "select" || interaction.scope === "trial_program";

  const content = (
    <>
      <div className="cc-top">
        <span className="lvl-chip">{trialClass.levelName}</span>
        {showCapacity && (
          <span className={`spots-chip spots-${spotTone}`}>
            <span className="dot" /> {trialClass.spotsAvailable}{" "}
            {trialClass.spotsAvailable === 1 ? "spot" : "spots"}
          </span>
        )}
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
        {interaction.kind === "select"
          ? "Request this class"
          : "Preview trial request"}
        <span aria-hidden="true">→</span>
      </div>
    </>
  );

  if (interaction.kind === "preview") {
    return (
      <button
        type="button"
        className={`class-card class-card--preview ${interaction.isSelected ? "on" : ""}`}
        onClick={() => interaction.onSelect(trialClass)}
        aria-pressed={interaction.isSelected}
        aria-label={`Preview the trial request form for ${trialClass.name}, ${trialClass.time} to ${trialClass.endTime}; final submission is unavailable until live trial inventory is verified`}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`class-card ${interaction.isSelected ? "on" : ""}`}
      onClick={() => interaction.onSelect(trialClass)}
    >
      {content}
    </button>
  );
}
