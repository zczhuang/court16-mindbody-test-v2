"use client";

import ClassCard from "@/components/ClassCard";
import type { TrialClass } from "@/lib/trial-types";
import type { KidsTrialCalendarPreviewScope } from "@/config/kids-trial-readiness";

interface Props {
  classes: TrialClass[];
  date: string | null;
  interaction:
    | {
        kind: "select";
        selectedClassId: number | null;
        onPick: (tc: TrialClass) => void;
      }
    | {
        kind: "preview";
        scope: KidsTrialCalendarPreviewScope;
      };
}

const DOW_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DayDetail({ classes, date, interaction }: Props) {
  const kidsSchedule = interaction.kind === "preview" && interaction.scope === "kids_schedule";
  const previewOnly = interaction.kind === "preview";

  if (!date) {
    return (
      <div className="detail empty-state" role="status" aria-live="polite">
        <div className="empty-ball" aria-hidden="true" />
        <div className="es-title">Pick a day to see classes</div>
        <div className="es-sub">
          Choose any highlighted day on the calendar to see the {kidsSchedule ? "kids" : "trial"}{" "}
          classes.
        </div>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="detail empty-state" role="status" aria-live="polite">
        <div className="es-title">
          {kidsSchedule ? "No kids classes on this day" : "No trials on this day"}
        </div>
        <div className="es-sub">
          Try another highlighted day for {kidsSchedule ? "scheduled kids" : "available trial"}{" "}
          classes.
        </div>
      </div>
    );
  }

  const dt = new Date(date + "T00:00");
  const dLabel = `${DOW_LONG[dt.getDay()]}, ${MONTH_NAMES[dt.getMonth()]} ${dt.getDate()}`;

  return (
    <div className="detail" aria-live="polite">
      <div className="detail-head">
        <div className="eyebrow">{dLabel}</div>
        <div className="detail-count">
          {classes.length} {classes.length === 1 ? "class" : "classes"}{" "}
          {kidsSchedule ? "scheduled" : "available"}
        </div>
      </div>
      {previewOnly && (
        <p className="class-list-preview-note" role="status">
          {kidsSchedule
            ? "Regular kids schedule for planning only — these are not confirmed trial openings."
            : "Trial calendar preview — online booking is not available here yet."}{" "}
          <a href="https://www.court16.com/contact">Ask our team about a trial</a>.
        </p>
      )}
      <div className={`class-list ${previewOnly ? "class-list--preview" : ""}`}>
        {classes.map((c) => (
          <ClassCard
            key={`${c.classId}-${c.date}`}
            trialClass={c}
            interaction={
              interaction.kind === "preview"
                ? { kind: "preview", scope: interaction.scope }
                : {
                    kind: "select",
                    isSelected: interaction.selectedClassId === c.classId,
                    onSelect: interaction.onPick,
                  }
            }
          />
        ))}
      </div>
    </div>
  );
}
