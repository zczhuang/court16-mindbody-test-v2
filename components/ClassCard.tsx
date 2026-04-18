"use client";

import type { TrialClass } from "@/lib/trial-types";
import { getLevelColor, formatShortDate } from "@/lib/class-utils";

interface Props {
  trialClass: TrialClass;
  isSelected: boolean;
  onSelect: (tc: TrialClass) => void;
}

export default function ClassCard({ trialClass, isSelected, onSelect }: Props) {
  const spotsColor =
    trialClass.spotsAvailable <= 1
      ? "text-red-600 bg-red-50"
      : trialClass.spotsAvailable <= 3
        ? "text-amber-700 bg-amber-50"
        : "text-green-700 bg-green-50";

  return (
    <button
      onClick={() => onSelect(trialClass)}
      className={`
        w-full text-left p-4 rounded-xl border-2 transition-all
        ${
          isSelected
            ? "border-c16-yellow bg-yellow-50 shadow-lg"
            : "border-gray-200 bg-white hover:border-c16-yellow hover:shadow-md"
        }
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <span
            className="inline-block px-2 py-0.5 rounded-full text-xs font-bold mb-2"
            style={{ backgroundColor: getLevelColor(trialClass.levelName) }}
          >
            {trialClass.levelName}
          </span>

          <h3 className="font-bold text-sm leading-tight">{trialClass.name}</h3>

          <p className="text-sm text-c16-gray-dark mt-1">
            {trialClass.time} – {trialClass.endTime} · {trialClass.coach}
          </p>

          <p className="text-xs text-c16-gray mt-1">
            {trialClass.dayOfWeek}, {formatShortDate(trialClass.date)}
          </p>
        </div>

        <span
          className={`px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap ${spotsColor}`}
        >
          {trialClass.spotsAvailable}{" "}
          {trialClass.spotsAvailable === 1 ? "spot" : "spots"}
        </span>
      </div>
    </button>
  );
}
