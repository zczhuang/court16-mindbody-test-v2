"use client";

import ClassCard from "@/components/ClassCard";
import type { TrialClass } from "@/lib/trial-types";

interface Props {
  classes: TrialClass[];
  date: string | null;
  selectedClassId: number | null;
  onPick: (tc: TrialClass) => void;
}

const DOW_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DayDetail({ classes, date, selectedClassId, onPick }: Props) {
  if (!date) {
    return (
      <div className="detail empty-state">
        <div className="illus" aria-hidden="true">
          <svg viewBox="0 0 80 80" width="72" height="72">
            <rect x="8" y="16" width="64" height="56" rx="6" fill="#fff" stroke="#1a1a1a" strokeWidth="2" />
            <rect x="8" y="16" width="64" height="14" fill="#FFE033" stroke="#1a1a1a" strokeWidth="2" />
            <line x1="24" y1="10" x2="24" y2="22" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
            <line x1="56" y1="10" x2="56" y2="22" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
            <circle cx="40" cy="50" r="10" fill="#FFE033" stroke="#1a1a1a" strokeWidth="2" />
            <path d="M31 50 Q40 44 49 50" fill="none" stroke="#1a1a1a" strokeWidth="1.2" />
            <path d="M31 50 Q40 56 49 50" fill="none" stroke="#1a1a1a" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="es-title">Pick a day to see classes</div>
        <div className="es-sub">
          Tap any green-chipped day on the calendar to browse available trial slots.
        </div>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="detail empty-state">
        <div className="es-title">No trials on this day</div>
        <div className="es-sub">Try another day — most clubs have weekend openings.</div>
      </div>
    );
  }

  const dt = new Date(date + "T00:00");
  const dLabel = `${DOW_LONG[dt.getDay()]}, ${MONTH_NAMES[dt.getMonth()]} ${dt.getDate()}`;

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="eyebrow">{dLabel}</div>
        <div className="detail-count">
          {classes.length} {classes.length === 1 ? "class" : "classes"} available
        </div>
      </div>
      <div className="class-list">
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
