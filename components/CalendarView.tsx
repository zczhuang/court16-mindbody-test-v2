"use client";

import { useMemo } from "react";
import type { TrialClass } from "@/lib/trial-types";

interface Props {
  classes: TrialClass[];
  year: number;
  month: number; // 1-indexed
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function CalendarView({
  classes,
  year,
  month,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: Props) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const classesByDate = useMemo(() => {
    const map: Record<string, TrialClass[]> = {};
    for (const c of classes) {
      if (!map[c.date]) map[c.date] = [];
      map[c.date].push(c);
    }
    return map;
  }, [classes]);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <button
          onClick={onPrevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-lg font-bold transition-colors"
          aria-label="Previous month"
        >
          ‹
        </button>
        <h3 className="font-bold text-lg">
          {MONTH_NAMES[month - 1]} {year}
        </h3>
        <button
          onClick={onNextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-lg font-bold transition-colors"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-semibold text-gray-400 uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`blank-${i}`} className="h-20 border-b border-r border-gray-50" />;
          }

          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayClasses = classesByDate[dateStr] || [];
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;
          const isSelected = dateStr === selectedDate;
          const hasClasses = dayClasses.length > 0;
          const totalSpots = dayClasses.reduce((s, c) => s + c.spotsAvailable, 0);

          return (
            <button
              key={dateStr}
              onClick={() => (hasClasses && !isPast ? onSelectDate(dateStr) : undefined)}
              disabled={!hasClasses || isPast}
              className={`
                h-20 p-1.5 border-b border-r border-gray-50 text-left transition-all relative
                ${isPast ? "opacity-40 cursor-default" : ""}
                ${!hasClasses && !isPast ? "cursor-default" : ""}
                ${hasClasses && !isPast ? "cursor-pointer hover:bg-yellow-50" : ""}
                ${isSelected ? "bg-yellow-50 ring-2 ring-c16-yellow ring-inset" : ""}
              `}
            >
              <span
                className={`text-sm font-semibold ${isToday ? "text-c16-black" : ""}`}
              >
                {day}
              </span>
              {isToday && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-c16-yellow rounded-full" />
              )}
              {hasClasses && (
                <div className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-c16-yellow rounded-full shrink-0" />
                    <span className="text-[10px] font-semibold text-c16-gray-dark truncate">
                      {dayClasses.length} {dayClasses.length === 1 ? "class" : "classes"}
                    </span>
                  </div>
                  <span className="text-[10px] text-c16-gray-dark">
                    {totalSpots} {totalSpots === 1 ? "spot" : "spots"}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
