"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RedesignChrome from "@/components/RedesignChrome";
import ProgressBar from "@/components/ProgressBar";
import LocationSelector from "@/components/LocationSelector";
import CalendarView from "@/components/CalendarView";
import DayDetail from "@/components/DayDetail";
import TrialRequestForm from "@/components/TrialRequestForm";
import ConfirmationScreen from "@/components/ConfirmationScreen";
import TrialSiteFooter from "@/components/TrialSiteFooter";
import { getLocationById, type Location } from "@/config/locations";
import type {
  CalendarClassDto,
  TrialClass,
  TrialRequest,
  TrialSubmissionStatus,
} from "@/lib/trial-types";
import { useSelectedLocation } from "@/lib/location-state";
import {
  parseClass,
  filterByAge,
  filterByTrialEligibility,
  filterAvailable,
} from "@/lib/class-utils";
import {
  maxBookableDateStr,
  todayStrInTz,
  TRIAL_CONFIG,
  TRIAL_MAX_ADVANCE_DAYS,
} from "@/config/trial-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import {
  getKidsTrialCalendarPreviewReadiness,
  getKidsTrialReadiness,
  type KidsTrialCalendarPreviewScope,
} from "@/config/kids-trial-readiness";
import type { ChildEntry } from "@/components/AgeSelector";

type Step = "location" | "calendar" | "confirmed";

function isTrialLocationReady(location: Location | undefined): boolean {
  if (!location) return false;
  return getKidsTrialReadiness({
    location,
    trialConfig: TRIAL_CONFIG[location.id],
    pipeline: getDealPipeline(location.id),
    preferredLocation: getHubspotPreferredLocation(location.id),
  }).ready;
}

/** Browse-only: the calendar may be viewed, but no class can be requested. */
function isTrialLocationPreviewOnly(location: Location | undefined): boolean {
  if (!location) return false;
  if (isTrialLocationReady(location)) return false;
  return getKidsTrialCalendarPreviewReadiness({ location }).ready;
}

function getTrialLocationPreviewScope(
  location: Location | undefined,
): KidsTrialCalendarPreviewScope | null {
  if (!location || isTrialLocationReady(location)) return null;
  const preview = getKidsTrialCalendarPreviewReadiness({ location });
  return preview.ready ? preview.scope : null;
}

/** Fully ready OR browse-only preview — either way the calendar may render. */
function isTrialLocationBrowsable(location: Location | undefined): location is Location {
  return Boolean(location) && (isTrialLocationReady(location) || isTrialLocationPreviewOnly(location));
}

function TrialInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { setLocation: setGlobalLoc } = useSelectedLocation();
  const urlLocation = params.get("location");
  // A bare /trial always starts at club selection. A location deep link may
  // skip ahead only when that club's trial pipeline is verified and enabled.
  const urlResolved = urlLocation ? getLocationById(urlLocation) : undefined;
  const preResolved = isTrialLocationBrowsable(urlResolved) ? urlResolved : null;

  const [step, setStep] = useState<Step>(preResolved ? "calendar" : "location");
  const [location, setLocation] = useState<Location | null>(preResolved);
  const syncedUrlLocationRef = useRef<string | null | undefined>(undefined);
  const renderedStepRef = useRef<Step>(step);

  const [allClasses, setAllClasses] = useState<TrialClass[]>([]);
  const [ageFilter, setAgeFilter] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<TrialClass | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submittedRequest, setSubmittedRequest] = useState<TrialRequest | null>(null);
  const [submittedCorrelationId, setSubmittedCorrelationId] = useState<string | undefined>(
    undefined,
  );
  const [submittedStatus, setSubmittedStatus] = useState<TrialSubmissionStatus>("manual_review");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const previewScope = getTrialLocationPreviewScope(location ?? undefined);
  const previewOnly = previewScope != null;
  const kidsSchedulePreview = previewScope === "kids_schedule";

  // Keep the visible step in sync with browser Back/Forward while rejecting
  // deep links for clubs that have not passed the launch-readiness gate.
  useEffect(() => {
    if (submittedRequest || syncedUrlLocationRef.current === urlLocation) return;
    syncedUrlLocationRef.current = urlLocation;

    // A history navigation represents a new visible step, so discard any
    // modal or class state from the page we just left. Forward navigation may
    // restore the club/calendar, but never a stale, previously open form.
    setShowFormModal(false);
    setSubmissionId(null);
    setSelectedClass(null);
    setSelectedDate(null);
    setAgeFilter(null);

    const loc = urlLocation ? getLocationById(urlLocation) : undefined;
    if (isTrialLocationBrowsable(loc)) {
      setLocation(loc);
      setGlobalLoc(loc);
      setStep("calendar");
    } else {
      setLocation(null);
      setStep("location");
    }
  }, [urlLocation, submittedRequest, setGlobalLoc]);

  const visibleClasses =
    ageFilter != null ? filterByAge(allClasses, ageFilter) : allClasses;
  const dayClasses = selectedDate
    ? visibleClasses.filter((c) => c.date === selectedDate)
    : [];

  const fetchClasses = useCallback(
    async (loc: Location, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setAllClasses([]);
      try {
        // Fetch the complete booking window in one request. A month-only
        // request falsely showed an empty state near month-end when valid
        // slots existed in the first days of the next month.
        const startDate = todayStrInTz(loc.timezone);
        const endDate = maxBookableDateStr(loc.timezone);
        // The server selects either the dedicated trial Program or this site's
        // explicit regular-kids Program allowlist. It never performs a broad
        // kids-trial fallback query.
        const resp = await fetch(
          `/api/mindbody/calendar?locationId=${loc.id}&startDate=${startDate}&endDate=${endDate}&intent=kid_trial`,
          { signal },
        );
        if (!resp.ok) throw new Error("Failed to load classes");
        const data = await resp.json();
        const calendarClasses: CalendarClassDto[] = data.classes || [];
        const expectedScope =
          getTrialLocationPreviewScope(loc) === "kids_schedule"
            ? "kids_schedule"
            : "trial_program";
        const expectedPreviewOnly = isTrialLocationPreviewOnly(loc);
        if (
          data.calendarScope !== expectedScope ||
          data.previewOnly !== expectedPreviewOnly
        ) {
          throw new Error("Calendar configuration changed. Please choose the club again.");
        }

        const parsed = calendarClasses.map(parseClass);
        const eligibleFiltered =
          expectedScope === "trial_program"
            ? filterByTrialEligibility(parsed, loc.id)
            : parsed;
        // Regular schedule previews include every public, non-cancelled row;
        // WebCapacity=0 is common and does not mean the class is unscheduled.
        // Fully launched trial booking still requires live web capacity.
        const displayClasses =
          expectedScope === "kids_schedule"
            ? eligibleFiltered
            : filterAvailable(eligibleFiltered);

        displayClasses.sort((a, b) => {
          return a.startsAt.localeCompare(b.startsAt);
        });
        setAllClasses(displayClasses);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load classes");
        setAllClasses([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!location || step !== "calendar") return;
    const controller = new AbortController();
    void fetchClasses(location, controller.signal);
    return () => controller.abort();
  }, [location, step, fetchClasses]);

  useEffect(() => {
    if (renderedStepRef.current === step) return;
    renderedStepRef.current = step;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("#trial-step-heading");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  function selectLoc(loc: Location) {
    if (!isTrialLocationBrowsable(loc)) return;
    setLocation(loc);
    setGlobalLoc(loc);
    setSelectedDate(null);
    setSelectedClass(null);
    setAgeFilter(null);
    setStep("calendar");
    router.push(`/trial?location=${encodeURIComponent(loc.id)}`, { scroll: false });
  }

  function backToLoc() {
    setStep("location");
    setLocation(null);
    setShowFormModal(false);
    setSubmissionId(null);
    setSelectedDate(null);
    setSelectedClass(null);
    setAgeFilter(null);
    router.push("/trial", { scroll: false });
  }

  function handleDateSelect(date: string) {
    setSelectedDate(date);
    setSelectedClass(null);
  }

  function handleClassSelect(tc: TrialClass) {
    // Browse-only preview: the calendar is visible but no request may start.
    // The intake route independently enforces full readiness; this guard just
    // keeps a parent from filling a form that would be refused on submit.
    if (isTrialLocationPreviewOnly(location ?? undefined)) return;
    setSelectedClass(tc);
    setSubmissionId(window.crypto.randomUUID());
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
    // Booking window: don't navigate past the month containing the last
    // bookable date (CalendarView also disables the button; this is belt
    // and suspenders).
    if (location) {
      const nextFirst =
        calMonth === 12
          ? `${calYear + 1}-01-01`
          : `${calYear}-${String(calMonth + 1).padStart(2, "0")}-01`;
      if (nextFirst > maxBookableDateStr(location.timezone)) return;
    }
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
    // HubSpot attribution context: pageUri/pageName make the Contact's
    // "form inquiry" activity link to THIS page instead of the legacy
    // website form; hutk (when the tracking cookie exists) ties the
    // submission to the visitor's analytics session.
    const hutk = document.cookie.match(/(?:^|;\s*)hubspotutk=([a-f0-9]{32})/i)?.[1];
    const hsContext = {
      hutk,
      pageUri: window.location.href,
      pageName: document.title,
    };
    const resp = await fetch("/api/book/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, hsContext }),
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
    const status: TrialSubmissionStatus =
      data.status === "pending_staff" ||
      data.status === "manual_review" ||
      data.status === "duplicate_email_softwall"
        ? data.status
        : "manual_review";
    setSubmittedRequest(request);
    setSubmittedCorrelationId(data.correlationId);
    setSubmittedStatus(status);
    setShowFormModal(false);
    setSubmissionId(null);
    setStep("confirmed");
  }

  if (step === "confirmed" && submittedRequest) {
    return (
      <div className="trial-page-shell">
        <RedesignChrome />
        <ConfirmationScreen
          request={submittedRequest}
          correlationId={submittedCorrelationId}
          status={submittedStatus}
        />
        <TrialSiteFooter />
      </div>
    );
  }

  return (
    <div className="trial-page-shell">
      <RedesignChrome previewScope={step === "calendar" ? previewScope : null} />
      <main className="c16-container" id="main-content">
        <ProgressBar
          step={showFormModal ? "details" : step}
          previewScope={step === "calendar" ? previewScope : null}
        />

        {step === "location" && (
          <>
            <LocationSelector
              selectedId={location?.id ?? null}
              onSelect={selectLoc}
              trialOnly
            />
          </>
        )}

        {step === "calendar" && location && (
          <section className="calendar-section">
            <div className="cal-topline">
              <button type="button" className="back-link" onClick={backToLoc}>
                <span aria-hidden="true">←</span> Change club
              </button>
              <div className="cal-context">
                <span className="eyebrow">
                  {previewOnly ? "Step 2 of 2" : "Step 2 of 3"}
                </span>
                <h2 id="trial-step-heading" className="section-title" tabIndex={-1}>
                  {kidsSchedulePreview
                    ? "Browse this club's kids schedule."
                    : previewOnly
                      ? "Preview their trial calendar."
                      : "Choose their trial class."}
                </h2>
                <p className="section-sub">
                  {kidsSchedulePreview
                    ? "Select a highlighted day to see the regular kids classes currently scheduled."
                    : previewOnly
                      ? "Select a highlighted day to see the dedicated trial times currently scheduled."
                      : "Select a highlighted day, then choose the class that best fits your child."}
                </p>
                <div className="loc-breadcrumb">
                  <span className="loc-pin" aria-hidden="true" />
                  <span>
                    {location.state} — {location.name}
                  </span>
                </div>
                <div
                  className="trial-reassurance"
                  aria-label={kidsSchedulePreview ? "Schedule details" : "Trial essentials"}
                >
                  {kidsSchedulePreview ? (
                    <>
                      <span>Public schedule</span>
                      <span>Read only</span>
                      <span>Ask about trials</span>
                    </>
                  ) : (
                    <>
                      <span>Free trial</span>
                      <span>No credit card</span>
                      <span>Racquet provided</span>
                      <span>Ages 3–17</span>
                    </>
                  )}
                </div>
                {previewOnly && (
                  <p className="trial-preview-note" role="status">
                    {kidsSchedulePreview
                      ? "Kids schedule preview — these are regular classes for planning only, not confirmed trial availability. Online trial booking isn't available here yet."
                      : "Trial calendar preview — these are dedicated trial times, but online booking isn't available here yet."}{" "}
                    <a href="https://www.court16.com/contact">Ask our team about a trial</a>.
                  </p>
                )}
              </div>
            </div>

            {loading && (
              <div className="empty-state" role="status" aria-live="polite">
                <div className="loading-ball" aria-hidden="true" />
                <div className="es-title">
                  {kidsSchedulePreview ? "Loading the kids schedule…" : "Checking trial availability…"}
                </div>
                <div className="es-sub">This usually takes only a moment.</div>
              </div>
            )}

            {error && (
              <div className="empty-state booking-error" role="alert">
                <div className="es-title">
                  We can still help at {location?.name || "this club"}.
                </div>
                <div className="es-sub">
                  {kidsSchedulePreview
                    ? "The live kids schedule did not load. Call or email and our team can help with class times and trial options."
                    : "Live trial availability did not load. Call or email and our team will match your child to a trial class."}
                </div>
                <div className="error-actions">
                  <a href="tel:+17188755550" className="btn primary">
                    Call 718-875-5550
                  </a>
                  <a
                    href={
                      kidsSchedulePreview
                        ? `mailto:hello@court16.com?subject=Kids%20schedule%20and%20trial%20at%20${encodeURIComponent(location?.name || "Court 16")}&body=Hi%20—%20I'd%20like%20help%20with%20the%20kids%20schedule%20and%20trial%20options%20at%20${encodeURIComponent(location?.name || "")}.`
                        : `mailto:hello@court16.com?subject=Trial%20at%20${encodeURIComponent(location?.name || "Court 16")}&body=Hi%20—%20I'd%20like%20to%20book%20a%20trial%20class%20at%20${encodeURIComponent(location?.name || "")}.%20Please%20get%20back%20to%20me%20with%20available%20times.`
                    }
                    className="btn ghost"
                  >
                    Email our team
                  </a>
                </div>
              </div>
            )}

            {!loading && !error && allClasses.length === 0 && (
              <div className="empty-state no-classes-state" role="status">
                <div className="empty-ball" aria-hidden="true" />
                <div className="es-title">
                  {kidsSchedulePreview
                    ? "No kids classes are scheduled right now."
                    : "No online trial times are posted right now."}
                </div>
                <div className="es-sub">
                  {kidsSchedulePreview ? (
                    <>
                      {location.name} has no public kids classes in the next{" "}
                      {TRIAL_MAX_ADVANCE_DAYS}
                      {TRIAL_MAX_ADVANCE_DAYS === 1 ? " day" : " days"}. Our team can help
                      with opening details and trial options.
                    </>
                  ) : (
                    <>
                      {location.name} has no kids-trial classes in the next{" "}
                      {TRIAL_MAX_ADVANCE_DAYS}
                      {TRIAL_MAX_ADVANCE_DAYS === 1 ? " day" : " days"}. Our team can help
                      find the next opening.
                    </>
                  )}
                </div>
                <div className="error-actions">
                  <a href="tel:+17188755550" className="btn primary">
                    Call 718-875-5550
                  </a>
                  <a
                    href={`mailto:hello@court16.com?subject=Kids%20trial%20at%20${encodeURIComponent(location.name)}&body=Hi%20—%20I'd%20like%20to%20ask%20about%20a%20kids%20trial%20at%20${encodeURIComponent(location.name)}.`}
                    className="btn ghost"
                  >
                    Ask about the next trial
                  </a>
                </div>
              </div>
            )}

            {!loading && !error && allClasses.length > 0 && (
              <>
                <div className="age-filter-row">
                  <label
                    htmlFor="age-filter"
                    className="eyebrow"
                  >
                    Child&apos;s age
                  </label>
                  <select
                    id="age-filter"
                    value={ageFilter ?? ""}
                    onChange={(e) =>
                      setAgeFilter(e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="age-filter-select"
                  >
                    <option value="">All ages</option>
                    {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((age) => (
                      <option key={age} value={age}>
                        Age {age}
                      </option>
                    ))}
                  </select>
                  {ageFilter != null && visibleClasses.length === 0 && (
                    <span className="age-filter-empty" role="status">
                      No classes match age {ageFilter}.
                    </span>
                  )}
                </div>
                <div className="cal-grid">
                  <div className="cal-col">
                    <CalendarView
                      classes={visibleClasses}
                      year={calYear}
                      month={calMonth}
                      selectedDate={selectedDate}
                      onSelectDate={handleDateSelect}
                      onPrevMonth={handlePrevMonth}
                      onNextMonth={handleNextMonth}
                      contentScope={kidsSchedulePreview ? "kids_schedule" : "trial"}
                      maxDateStr={maxBookableDateStr(location.timezone)}
                    />
                  </div>
                  <aside className="detail-col">
                    <DayDetail
                      classes={dayClasses}
                      date={selectedDate}
                      interaction={
                        previewScope
                          ? { kind: "preview", scope: previewScope }
                          : {
                              kind: "select",
                              selectedClassId: selectedClass?.classId ?? null,
                              onPick: handleClassSelect,
                            }
                      }
                    />
                  </aside>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {showFormModal && selectedClass && location && submissionId && (
        <TrialRequestForm
          submissionId={submissionId}
          trialClass={selectedClass}
          kids={DEFAULT_KIDS}
          locationId={location.id}
          locationName={location.fullName}
          genderOptions={TRIAL_CONFIG[location.id]?.mindbodyGenderOptions ?? []}
          onSubmit={handleTrialSubmit}
          onCancel={() => {
            setShowFormModal(false);
            setSubmissionId(null);
            setSelectedClass(null);
          }}
        />
      )}
      <TrialSiteFooter />
    </div>
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
