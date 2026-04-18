"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import AgeSelector, { type ChildEntry } from "@/components/AgeSelector";
import LocationSelector from "@/components/LocationSelector";
import CalendarView from "@/components/CalendarView";
import ClassCard from "@/components/ClassCard";
import TrialRequestForm from "@/components/TrialRequestForm";
import ConfirmationScreen from "@/components/ConfirmationScreen";
import type { Location } from "@/config/locations";
import type { TrialClass, TrialRequest, MindBodyClass } from "@/lib/trial-types";
import { AGE_TO_LEVEL_MAP } from "@/config/trial-config";
import {
  parseClass,
  filterByTrialEligibility,
  filterChildrenOnly,
  filterAvailable,
  formatLongDate,
} from "@/lib/class-utils";

type Step = "setup" | "calendar" | "confirmed";

export default function TrialPage() {
  const [step, setStep] = useState<Step>("setup");
  const [kids, setKids] = useState<ChildEntry[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [allClasses, setAllClasses] = useState<TrialClass[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<TrialClass | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<TrialRequest | null>(null);
  const [submittedCorrelationId, setSubmittedCorrelationId] = useState<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);

  const dayClasses = selectedDate ? allClasses.filter((c) => c.date === selectedDate) : [];

  const getAllowedLevels = useCallback((): string[] => {
    const levels = new Set<string>();
    for (const kid of kids) {
      const kidLevels = AGE_TO_LEVEL_MAP[String(kid.age)];
      if (kidLevels) kidLevels.forEach((l) => levels.add(l));
    }
    return Array.from(levels);
  }, [kids]);

  const fetchClasses = useCallback(
    async (loc: Location, year: number, month: number) => {
      setLoading(true);
      setError(null);
      try {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
        const resp = await fetch(
          `/api/mindbody/calendar?locationId=${loc.id}&startDate=${startDate}&endDate=${endDate}`,
        );
        if (!resp.ok) throw new Error("Failed to load classes");
        const data = await resp.json();
        const mbClasses: MindBodyClass[] = data.classes || [];

        const childrenClasses = filterChildrenOnly(mbClasses);
        const parsed = childrenClasses.map(parseClass);
        const allowedLevels = getAllowedLevels();
        let ageFiltered =
          allowedLevels.length > 0
            ? parsed.filter((c) => allowedLevels.some((level) => c.levelName === level))
            : parsed;
        if (ageFiltered.length === 0 && parsed.length > 0) ageFiltered = parsed;
        const eligibleFiltered = filterByTrialEligibility(ageFiltered, loc.id);
        const available = filterAvailable(eligibleFiltered);

        available.sort((a, b) => {
          const d = a.date.localeCompare(b.date);
          if (d !== 0) return d;
          return a.time.localeCompare(b.time);
        });
        setAllClasses(available);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load classes");
        setAllClasses([]);
      } finally {
        setLoading(false);
      }
    },
    [getAllowedLevels],
  );

  useEffect(() => {
    if (location && kids.length > 0 && kids.every((k) => k.age > 0)) {
      fetchClasses(location, calYear, calMonth);
    }
  }, [location, kids, calYear, calMonth, fetchClasses]);

  const setupValid =
    kids.length > 0 && kids.every((k) => k.age > 0) && location !== null;

  function handleDateSelect(date: string) {
    setSelectedDate(date);
    setSelectedClass(null);
  }

  function handleClassSelect(tc: TrialClass) {
    setSelectedClass(tc);
    setShowFormModal(true);
  }

  function handlePrevMonth() {
    setSelectedDate(null);
    setSelectedClass(null);
    if (calMonth === 1) {
      setCalMonth(12);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    setSelectedDate(null);
    setSelectedClass(null);
    if (calMonth === 12) {
      setCalMonth(1);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
    }
  }

  async function handleTrialSubmit(request: TrialRequest) {
    const resp = await fetch("/api/book/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      // Server returns `error` as a string or a nested object ({name,message,status,body}).
      // Pull a human-readable message out of either shape; never serialize [object Object].
      const raw = data.error;
      let message: string;
      if (typeof raw === "string") message = raw;
      else if (raw && typeof raw === "object" && "message" in raw)
        message = String((raw as { message?: string }).message ?? "Unknown error");
      else if (Array.isArray(data.errors) && data.errors.length > 0)
        message = data.errors.join(", ");
      else message = `Failed to submit (${resp.status})`;
      throw new Error(message);
    }
    const data = await resp.json().catch(() => ({}));
    setSubmittedRequest(request);
    setSubmittedCorrelationId(data.correlationId);
    setShowFormModal(false);
    setStep("confirmed");
  }

  const ageSummary =
    kids.length === 1
      ? `Age ${kids[0].age}`
      : kids.map((k) => `${k.label}: age ${k.age}`).join(", ");

  if (step === "confirmed" && submittedRequest) {
    return (
      <div className="min-h-screen bg-white">
        <Header locationId={submittedRequest.locationId} />
        <ConfirmationScreen request={submittedRequest} correlationId={submittedCorrelationId} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Header locationId={location?.id} />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Progress (2 steps) */}
        <div className="flex items-center gap-2 mb-8 text-xs sm:text-sm">
          {(["setup", "calendar"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  stepIndex(step) >= i
                    ? "bg-c16-yellow text-c16-black"
                    : "bg-gray-100 text-c16-gray"
                }`}
              >
                {i + 1}
              </div>
              <span
                className={`font-semibold hidden sm:inline ${
                  stepIndex(step) >= i ? "text-c16-black" : "text-c16-gray"
                }`}
              >
                {s === "setup" ? "Details" : "Pick a class"}
              </span>
              {i < 1 && <div className="w-6 h-0.5 bg-gray-200 hidden sm:block" />}
            </div>
          ))}
        </div>

        {step === "setup" && (
          <section className="max-w-3xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
              Book a Free Trial
            </h1>
            <p className="text-sm text-c16-gray-dark mb-8">
              We&apos;ll show real Court 16 classes matched to your kid&apos;s age and your preferred club.
            </p>

            <div className="mb-8">
              <h2 className="text-base font-bold mb-3">1. Which club?</h2>
              <LocationSelector
                selectedId={location?.id ?? null}
                onSelect={(loc) => setLocation(loc)}
              />
            </div>

            <div
              className={`mb-8 transition-opacity ${
                location ? "opacity-100" : "opacity-40 pointer-events-none"
              }`}
            >
              <h2 className="text-base font-bold mb-1">2. Who&apos;s playing?</h2>
              <p className="text-xs text-c16-gray-dark mb-3">
                {location
                  ? `We'll filter ${location.name} classes to match your kid's age.`
                  : "Pick a club first."}
              </p>
              <AgeSelector value={kids} onChange={setKids} />
            </div>

            <button
              onClick={() => setStep("calendar")}
              disabled={!setupValid}
              className={`
                w-full sm:w-auto px-8 py-3 rounded-xl font-semibold text-sm transition-colors
                ${
                  setupValid
                    ? "bg-c16-black text-white hover:bg-c16-dark"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }
              `}
            >
              See available classes →
            </button>
          </section>
        )}

        {step === "calendar" && (
          <section>
            <button
              onClick={() => {
                setStep("setup");
                setSelectedClass(null);
                setSelectedDate(null);
              }}
              className="text-sm text-c16-gray-dark hover:text-c16-black mb-4 inline-flex items-center gap-1"
            >
              ← Edit details
            </button>

            <div className="mb-4">
              <h2 className="text-xl font-bold">Browse available classes</h2>
              <p className="text-sm text-c16-gray-dark">
                {ageSummary} · {location?.fullName}
              </p>
            </div>

            {loading && (
              <div className="text-center py-12">
                <div className="w-10 h-10 border-4 border-c16-yellow border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-c16-gray-dark">Loading classes...</p>
              </div>
            )}

            {error && <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

            {!loading && !error && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                  <CalendarView
                    classes={allClasses}
                    year={calYear}
                    month={calMonth}
                    selectedDate={selectedDate}
                    onSelectDate={handleDateSelect}
                    onPrevMonth={handlePrevMonth}
                    onNextMonth={handleNextMonth}
                  />
                  {allClasses.length === 0 && (
                    <div className="text-center py-8 mt-4 bg-gray-50 rounded-xl">
                      <p className="text-sm font-bold mb-1">No classes this month</p>
                      <p className="text-xs text-c16-gray-dark">
                        Try navigating to next month, or choose a different club.
                      </p>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2">
                  <h3 className="font-bold text-sm mb-3 text-c16-gray-dark uppercase tracking-wide">
                    Classes
                  </h3>

                  {!selectedDate && (
                    <div className="flex flex-col items-center justify-center h-[360px] text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 px-6">
                      <div className="text-4xl mb-3">📅</div>
                      <p className="text-sm font-bold mb-1">Select a day on the calendar</p>
                      <p className="text-xs text-c16-gray-dark">
                        Click a day with classes to see available trial slots
                      </p>
                    </div>
                  )}

                  {selectedDate && dayClasses.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-[360px] text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 px-6">
                      <p className="text-sm font-bold mb-1">No classes on this day</p>
                      <p className="text-xs text-c16-gray-dark">Try selecting a different day</p>
                    </div>
                  )}

                  {selectedDate && dayClasses.length > 0 && (
                    <div>
                      <p className="text-xs text-c16-gray-dark mb-3">
                        {formatLongDate(selectedDate)} · {dayClasses.length}{" "}
                        {dayClasses.length === 1 ? "class" : "classes"}
                      </p>
                      <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                        {dayClasses.map((tc) => (
                          <ClassCard
                            key={`${tc.classScheduleId}-${tc.date}`}
                            trialClass={tc}
                            isSelected={
                              selectedClass?.classScheduleId === tc.classScheduleId &&
                              selectedClass?.date === tc.date
                            }
                            onSelect={handleClassSelect}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {showFormModal && selectedClass && location && (
        <TrialRequestForm
          trialClass={selectedClass}
          kids={kids}
          locationId={location.id}
          locationName={location.fullName}
          onSubmit={handleTrialSubmit}
          onCancel={() => {
            setShowFormModal(false);
            setSelectedClass(null);
          }}
        />
      )}
    </div>
  );
}

function stepIndex(step: Step): number {
  const order: Step[] = ["setup", "calendar", "confirmed"];
  return order.indexOf(step);
}
