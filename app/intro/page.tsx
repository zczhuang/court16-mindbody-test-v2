"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import LocationSelector from "@/components/LocationSelector";
import OfferPicker from "@/components/OfferPicker";
import CalendarView from "@/components/CalendarView";
import DayDetail from "@/components/DayDetail";
import AdultRequestForm, { type AdultRequest } from "@/components/AdultRequestForm";
import { getLocationById, type Location } from "@/config/locations";
import type { AdultOffer } from "@/config/adult-config";
import type { TrialClass, MindBodyClass } from "@/lib/trial-types";
import { parseClass, filterAdultOnly, filterAvailable } from "@/lib/class-utils";
import { useSelectedLocation } from "@/lib/location-state";

type Step = "setup" | "calendar";

function IntroInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { location: globalLoc, setLocation: setGlobalLoc } = useSelectedLocation();
  const urlLocation = params.get("location");
  const preResolved =
    (urlLocation ? getLocationById(urlLocation) : null) ?? globalLoc ?? null;

  const [step, setStep] = useState<Step>("setup");
  const [location, setLocation] = useState<Location | null>(preResolved);
  useEffect(() => {
    if (urlLocation) {
      const loc = getLocationById(urlLocation);
      if (loc && loc.id !== globalLoc?.id) setGlobalLoc(loc);
    }
  }, [urlLocation, globalLoc, setGlobalLoc]);
  const [offer, setOffer] = useState<AdultOffer | null>(null);
  const [allClasses, setAllClasses] = useState<TrialClass[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<TrialClass | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
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
        const adultClasses = filterAdultOnly(mbClasses);
        const parsed = adultClasses.map(parseClass);
        const available = filterAvailable(parsed);
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

  const setupValid = location !== null && offer !== null;

  function continueToCalendar() {
    if (setupValid) setStep("calendar");
  }
  function backToSetup() {
    setStep("setup");
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
    } else setCalMonth((m) => m - 1);
  }
  function handleNextMonth() {
    setSelectedDate(null);
    setSelectedClass(null);
    if (calMonth === 12) {
      setCalMonth(1);
      setCalYear((y) => y + 1);
    } else setCalMonth((m) => m + 1);
  }

  async function handleAdultSubmit(request: AdultRequest) {
    const resp = await fetch("/api/book/intro", {
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
    const data = await resp.json();
    if (data.status === "duplicate_email_softwall") {
      router.push(`/intro/confirmed?correlationId=${data.correlationId}&status=softwall`);
      return;
    }
    if (data.cartUrl) {
      // Redirect to MindBody's hosted cart. After payment, MindBody
      // redirects back to the Return URL configured on the site, which
      // should point at /intro/confirmed?correlationId={cid}.
      const returnUrl =
        `${window.location.origin}/intro/confirmed?correlationId=${data.correlationId}`;
      sessionStorage.setItem(`intro-return-${data.correlationId}`, returnUrl);
      window.location.href = data.cartUrl;
      return;
    }
    // No cart URL for some reason — fall back to confirmation page.
    router.push(`/intro/confirmed?correlationId=${data.correlationId}`);
  }

  return (
    <>
      <Header />
      <div className="c16-container">
        <div className="c16-progress">
          <div className="prog-lead">
            Pick a club and offer — pay via MindBody to lock it in.
          </div>
          <div className="prog-rail">
            <div className={`prog-step ${step === "setup" ? "on current" : "on"}`}>
              <span className="prog-dot">{step === "setup" ? "1" : "✓"}</span>
              <span className="prog-lbl">Setup</span>
            </div>
            <div className={`prog-line ${step === "calendar" ? "on" : ""}`} />
            <div className={`prog-step ${step === "calendar" ? "on current" : ""}`}>
              <span className="prog-dot">2</span>
              <span className="prog-lbl">Class</span>
            </div>
          </div>
        </div>

        {step === "setup" && (
          <>
            <div className="section-head">
              <div className="eyebrow">Step 1 of 2</div>
              <h1 className="section-title">
                Book an adult <em>intro</em>
              </h1>
              <p className="section-sub">
                Pick a Court 16 club and the intro offer you want. Tennis $75 or
                Pickleball $58 — one session, no commitment.
              </p>
            </div>

            <section style={{ padding: "0 0 36px" }}>
              <h2
                style={{
                  fontFamily: "var(--f-display)",
                  fontWeight: 700,
                  fontSize: 20,
                  letterSpacing: "-0.025em",
                  margin: "0 0 16px",
                }}
              >
                1. Which club?
              </h2>
              <LocationSelector
                selectedId={location?.id ?? null}
                onSelect={(loc) => setLocation(loc)}
                suppressHead
              />
            </section>

            <section
              style={{
                padding: "0 0 36px",
                opacity: location ? 1 : 0.4,
                pointerEvents: location ? "auto" : "none",
                transition: "opacity .15s ease",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--f-display)",
                  fontWeight: 700,
                  fontSize: 20,
                  letterSpacing: "-0.025em",
                  margin: "0 0 16px",
                }}
              >
                2. Which offer?
              </h2>
              <OfferPicker
                selectedKey={offer?.key ?? null}
                onSelect={(o) => setOffer(o)}
              />
            </section>

            {setupValid && (
              <div className="sticky-continue">
                <div className="sc-inner">
                  <div className="sc-label">
                    <span className="eyebrow">Selected</span>
                    <strong>
                      {offer?.displayName} · {location?.name}
                    </strong>
                    <span className="sc-addr">
                      ${offer?.priceUsd} · {location?.address}
                    </span>
                  </div>
                  <button type="button" className="btn primary" onClick={continueToCalendar}>
                    Pick a class
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

        {step === "calendar" && location && offer && (
          <section className="calendar-section">
            <div className="cal-topline">
              <button type="button" className="back-link" onClick={backToSetup}>
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
                Change club or offer
              </button>
              <div className="cal-context">
                <span className="eyebrow">Step 2 of 2</span>
                <h1 className="section-title">Pick your class</h1>
                <div className="loc-breadcrumb">
                  <span>
                    {offer.displayName} · {location.state} — {location.name}
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

      {showFormModal && selectedClass && location && offer && (
        <AdultRequestForm
          trialClass={selectedClass}
          locationId={location.id}
          offer={offer}
          onSubmit={handleAdultSubmit}
          onCancel={() => {
            setShowFormModal(false);
            setSelectedClass(null);
          }}
        />
      )}
    </>
  );
}

export default function IntroPage() {
  return (
    <Suspense fallback={null}>
      <IntroInner />
    </Suspense>
  );
}
