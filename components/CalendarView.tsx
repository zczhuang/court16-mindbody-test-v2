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

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          onClick={onPrevMonth}
          aria-label="Previous month"
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M10 3l-5 5 5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="cal-title">
          {MONTH_NAMES[month - 1]} {year}
        </div>
        <button
          type="button"
          className="cal-nav"
          onClick={onNextMonth}
          aria-label="Next month"
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M6 3l5 5-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="cal-dow">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="cal-body">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`blank-${i}`} className="cal-cell empty" />;
          }
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayClasses = classesByDate[dateStr] || [];
          const has = dayClasses.length > 0;
          const spots = dayClasses.reduce((s, c) => s + c.spotsAvailable, 0);
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;

          return (
            <button
              key={dateStr}
              type="button"
              className={`cal-cell ${isPast ? "past" : ""} ${has ? "has" : ""} ${isSelected ? "sel" : ""} ${isToday ? "today" : ""}`}
              disabled={!has || isPast}
              onClick={() => onSelectDate(dateStr)}
            >
              <span className="cal-num">{day}</span>
              {isToday && !isPast && <span className="today-dot" />}
              {has && (
                <span className="cal-tag">
                  <span className="tag-count">
                    {dayClasses.length} {dayClasses.length === 1 ? "class" : "classes"}
                  </span>
                  <span className="tag-spots">
                    {spots} {spots === 1 ? "spot" : "spots"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span>
          <span className="sw sw-has" /> Classes available
        </span>
        <span>
          <span className="sw sw-sel" /> Selected
        </span>
        <span>
          <span className="sw sw-none" /> No trials
        </span>
      </div>
    </div>
  );
}
