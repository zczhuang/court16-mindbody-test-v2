"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import ProgressBar from "@/components/ProgressBar";
import LocationSelector from "@/components/LocationSelector";
import CalendarView from "@/components/CalendarView";
import DayDetail from "@/components/DayDetail";
import TrialRequestForm from "@/components/TrialRequestForm";
import ConfirmationScreen from "@/components/ConfirmationScreen";
import { getLocationById, type Location } from "@/config/locations";
import type { TrialClass, TrialRequest, MindBodyClass } from "@/lib/trial-types";
import { useSelectedLocation } from "@/lib/location-state";
import {
  parseClass,
  filterByTrialEligibility,
  filterChildrenOnly,
  filterAvailable,
} from "@/lib/class-utils";
import type { ChildEntry } from "@/components/AgeSelector";

type Step = "location" | "calendar" | "confirmed";

function TrialInner() {
  const params = useSearchParams();
  const { location: globalLoc, setLocation: setGlobalLoc } = useSelectedLocation();
  const urlLocation = params.get("location");
  const preResolved =
    (urlLocation ? getLocationById(urlLocation) : null) ?? globalLoc ?? null;

  const [step, setStep] = useState<Step>(preResolved ? "calendar" : "location");
  const [location, setLocation] = useState<Location | null>(preResolved);

  // Mirror into global state the first time we see a URL-provided location.
  useEffect(() => {
    if (urlLocation) {
      const loc = getLocationById(urlLocation);
      if (loc && loc.id !== globalLoc?.id) setGlobalLoc(loc);
    }
  }, [urlLocation, globalLoc, setGlobalLoc]);
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
        const eligibleFiltered = filterByTrialEligibility(parsed, loc.id);
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
    [],
  );

  useEffect(() => {
    if (location && step === "calendar") fetchClasses(location, calYear, calMonth);
  }, [location, step, calYear, calMonth, fetchClasses]);

  function selectLoc(loc: Location) {
    setLocation(loc);
  }

  function continueFromLoc() {
    if (location) setStep("calendar");
  }

  function backToLoc() {
    setStep("location");
    setSelectedDate(null);
    setSelectedClass(null);
  }

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

  if (step === "confirmed" && submittedRequest) {
    return (
      <>
        <Header />
        <ConfirmationScreen request={submittedRequest} correlationId={submittedCorrelationId} />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="c16-container">
        <ProgressBar step={step} />

        {step === "location" && (
          <>
            <LocationSelector selectedId={location?.id ?? null} onSelect={selectLoc} />
            {location && (
              <div className="sticky-continue">
                <div className="sc-inner">
                  <div className="sc-label">
                    <span className="eyebrow">Selected</span>
                    <strong>{location.name}</strong>
                    <span className="sc-addr">
                      {location.address}, {location.city}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={continueFromLoc}
                  >
                    See available classes
                    <svg viewBox="0 0 16 16" width="14" height="14">
                      <path
                        d="M2 8h11M9 4l4 4-4 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {step === "calendar" && location && (
          <section className="calendar-section">
            <div className="cal-topline">
              <button type="button" className="back-link" onClick={backToLoc}>
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path
                    d="M10 3l-5 5 5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Change club
              </button>
              <div className="cal-context">
                <span className="eyebrow">Step 2 of 2</span>
                <h1 className="section-title">Available trial classes</h1>
                <div className="loc-breadcrumb">
                  <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                    <path
                      d="M7 1c-2.5 0-4.5 2-4.5 4.5 0 3.5 4.5 7.5 4.5 7.5s4.5-4 4.5-7.5C11.5 3 9.5 1 7 1z"
                      fill="#e53935"
                      stroke="#1a1a1a"
                      strokeWidth="1"
                    />
                    <circle cx="7" cy="5.5" r="1.4" fill="#fff" />
                  </svg>
                  <span>
                    {location.state} — {location.name}
                  </span>
                </div>
              </div>
            </div>

            {loading && (
              <div className="empty-state">
                <div className="es-title">Loading classes…</div>
                <div className="es-sub">Fetching live availability from MindBody.</div>
              </div>
            )}

            {error && (
              <div className="empty-state" style={{ borderColor: "#c62828", color: "#c62828" }}>
                <div className="es-title">Something went wrong</div>
                <div className="es-sub">{error}</div>
              </div>
            )}

            {!loading && !error && (
              <div className="cal-grid">
                <div className="cal-col">
                  <CalendarView
                    classes={allClasses}
                    year={calYear}
                    month={calMonth}
                    selectedDate={selectedDate}
                    onSelectDate={handleDateSelect}
                    onPrevMonth={handlePrevMonth}
                    onNextMonth={handleNextMonth}
                  />
                </div>
                <aside className="detail-col">
                  <DayDetail
                    classes={dayClasses}
                    date={selectedDate}
                    selectedClassId={selectedClass?.classScheduleId ?? null}
                    onPick={handleClassSelect}
                  />
                </aside>
              </div>
            )}
          </section>
        )}
      </div>

      {showFormModal && selectedClass && location && (
        <TrialRequestForm
          trialClass={selectedClass}
          kids={DEFAULT_KIDS}
          locationId={location.id}
          locationName={location.fullName}
          onSubmit={handleTrialSubmit}
          onCancel={() => {
            setShowFormModal(false);
            setSelectedClass(null);
          }}
        />
      )}
    </>
  );
}

// Modal collects child age + name inline; we seed a single placeholder kid
// entry with age=0 so the form's per-kid inputs render correctly.
const DEFAULT_KIDS: ChildEntry[] = [{ label: "Kid 1", age: 0 }];

export default function TrialPage() {
  return (
    <Suspense fallback={null}>
      <TrialInner />
    </Suspense>
  );
}
