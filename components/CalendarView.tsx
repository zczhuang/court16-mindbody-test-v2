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
  /** Site-local today, so calendar boundaries do not depend on browser TZ. */
  todayStr?: string;
  /** Changes only calendar language; regular kids schedule rows stay read-only. */
  contentScope?: "trial" | "kids_schedule";
  /** Show raw Mindbody spot totals only where they represent current availability. */
  showSpotCounts?: boolean;
  /** Dedicated-trial occurrences that are inside the active booking window. */
  bookableClassIds?: ReadonlySet<number>;
  /**
   * Last visible date "YYYY-MM-DD" (inclusive). Days beyond it render
   * disabled and next-month nav stops once the window is exhausted.
   */
  maxVisibleDateStr?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default function CalendarView({
  classes,
  year,
  month,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  todayStr: providedTodayStr,
  contentScope = "trial",
  showSpotCounts = true,
  bookableClassIds,
  maxVisibleDateStr,
}: Props) {
  const kidsSchedule = contentScope === "kids_schedule";
  const today = new Date();
  const todayStr =
    providedTodayStr ??
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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

  const nextMonthFirst =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const nextDisabled = !!maxVisibleDateStr && nextMonthFirst > maxVisibleDateStr;

  return (
    <div className={`cal ${kidsSchedule ? "cal--kids-schedule" : ""}`}>
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
          disabled={nextDisabled}
          style={nextDisabled ? { opacity: 0.35, cursor: "default" } : undefined}
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
          const bookableCount =
            bookableClassIds == null
              ? dayClasses.length
              : dayClasses.filter((trialClass) => bookableClassIds.has(trialClass.classId))
                  .length;
          const hasBookableClass = has && bookableCount > 0;
          const outsideBookingWindow =
            has && bookableClassIds != null && !hasBookableClass;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;
          const isBeyondWindow = !!maxVisibleDateStr && dateStr > maxVisibleDateStr;
          const fullDate = FULL_DATE_FORMATTER.format(new Date(year, month - 1, day));
          const availabilityLabel = has
            ? kidsSchedule
              ? `${dayClasses.length} ${dayClasses.length === 1 ? "class" : "classes"} scheduled`
              : bookableClassIds != null
                ? `${dayClasses.length} trial ${dayClasses.length === 1 ? "time" : "times"} shown; ${outsideBookingWindow ? "outside booking window" : `${bookableCount} within booking window`}`
                : showSpotCounts
                ? `${dayClasses.length} ${dayClasses.length === 1 ? "class" : "classes"}, ${spots} ${spots === 1 ? "spot" : "spots"}`
                : `${dayClasses.length} trial ${dayClasses.length === 1 ? "time" : "times"} shown`
            : kidsSchedule
              ? "No kids classes"
              : "No trial classes";

          return (
            <button
              key={dateStr}
              type="button"
              className={`cal-cell ${isPast || isBeyondWindow ? "past" : ""} ${hasBookableClass && !isBeyondWindow ? "has" : ""} ${outsideBookingWindow && !isPast && !isBeyondWindow ? "locked" : ""} ${isSelected ? "sel" : ""} ${isToday ? "today" : ""}`}
              disabled={!has || isPast || isBeyondWindow}
              onClick={() => onSelectDate(dateStr)}
              aria-label={`${fullDate}: ${availabilityLabel}`}
              aria-pressed={has && !isPast && !isBeyondWindow ? isSelected : undefined}
              aria-current={isToday ? "date" : undefined}
            >
              <span className="cal-num">{day}</span>
              {isToday && !isPast && <span className="today-dot" />}
              {has && !isBeyondWindow && (
                <span className="cal-tag">
                  <span className="tag-count">
                    <span>{dayClasses.length}</span>{" "}
                    <span className="tag-count-label">
                      {kidsSchedule || showSpotCounts
                        ? dayClasses.length === 1
                          ? "class"
                          : "classes"
                        : dayClasses.length === 1
                          ? "time"
                          : "times"}
                    </span>
                  </span>
                  {!kidsSchedule && showSpotCounts && (
                    <span className="tag-spots">
                      {spots} {spots === 1 ? "spot" : "spots"}
                    </span>
                  )}
                  {bookableClassIds != null && (
                    <span className="tag-window">
                      {outsideBookingWindow
                        ? "Outside window"
                        : `${bookableCount} in window`}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span>
          <span className="sw sw-has" />{" "}
          {kidsSchedule
            ? "Classes scheduled"
            : bookableClassIds != null
              ? "Within booking window"
              : "Trial times shown"}
        </span>
        {bookableClassIds != null && (
          <span>
            <span className="sw sw-locked" /> Outside booking window
          </span>
        )}
        <span>
          <span className="sw sw-sel" /> Selected
        </span>
        <span>
          <span className="sw sw-none" /> {kidsSchedule ? "No kids classes" : "No trials"}
        </span>
      </div>
    </div>
  );
}
