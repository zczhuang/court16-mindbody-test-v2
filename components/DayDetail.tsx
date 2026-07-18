"use client";

import ClassCard from "@/components/ClassCard";
import type { TrialClass } from "@/lib/trial-types";

interface Props {
  classes: TrialClass[];
  date: string | null;
  selectedClassId: number | null;
  onPick: (tc: TrialClass) => void;
  /** Browse-only calendar preview: show times, hide the booking CTA. */
  previewOnly?: boolean;
}

const DOW_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DayDetail({ classes, date, selectedClassId, onPick, previewOnly }: Props) {
  if (!date) {
    return (
      <div className="detail empty-state" role="status" aria-live="polite">
        <div className="empty-ball" aria-hidden="true" />
        <div className="es-title">Pick a day to see classes</div>
        <div className="es-sub">
          Choose any highlighted day on the calendar to see the trial classes.
        </div>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="detail empty-state" role="status" aria-live="polite">
        <div className="es-title">No trials on this day</div>
        <div className="es-sub">Try another highlighted day for available trial classes.</div>
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
          {classes.length} {classes.length === 1 ? "class" : "classes"} available
        </div>
      </div>
      {previewOnly && (
        <p className="class-list-preview-note" role="status">
          Online booking for this club opens soon — these times are a preview.
        </p>
      )}
      <div className={`class-list ${previewOnly ? "class-list--preview" : ""}`}>
        {classes.map((c) => (
          <ClassCard
            key={`${c.classScheduleId}-${c.date}`}
            trialClass={c}
            isSelected={selectedClassId === c.classScheduleId}
            onSelect={onPick}
          />
        ))}
      </div>
    </div>
  );
}
