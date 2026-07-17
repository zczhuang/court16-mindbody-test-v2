"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import PathCard from "@/components/PathCard";
import LocationSelector from "@/components/LocationSelector";
import { useSelectedLocation } from "@/lib/location-state";
import { getLocationById } from "@/config/locations";

function BookInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { location, setLocation } = useSelectedLocation();
  const urlLocation = params.get("location");
  const urlCandidate = urlLocation ? getLocationById(urlLocation) : undefined;
  const urlResolved = urlCandidate?.publicBookingEnabled ? urlCandidate : null;
  const globalResolved = location?.publicBookingEnabled ? location : null;

  // URL param wins over global state — matches SoulCycle's deep-link
  // behavior where /studios/NYC switches regions globally.
  useEffect(() => {
    if (!urlLocation) {
      if (location && !location.publicBookingEnabled) setLocation(null);
      return;
    }
    const loc = getLocationById(urlLocation);
    if (loc?.publicBookingEnabled) {
      if (location?.id !== loc.id) setLocation(loc);
    } else if (location?.id === urlLocation) {
      setLocation(null);
    }
  }, [urlLocation, location, setLocation]);

  // An explicit URL wins. Invalid or disabled deep links show the selector
  // instead of silently falling back to a different club from localStorage.
  const resolved = urlLocation ? urlResolved : globalResolved;
  const qs = resolved ? `?location=${resolved.id}` : "";

  if (!resolved) {
    return (
      <>
        <Header />
        <div className="c16-container">
          <section style={{ padding: "56px 0 20px", textAlign: "center" }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              Court 16
            </div>
            <h1 className="section-title">
              Pick a <em>club</em>
            </h1>
            <p className="section-sub">
              Six clubs across NY, PA &amp; MA. We&apos;ll show only the classes at your pick.
            </p>
          </section>
          <section style={{ padding: "0 0 80px" }}>
            <LocationSelector
              selectedId={null}
              onSelect={(loc) => {
                setLocation(loc);
                router.replace(`/book?location=${loc.id}`);
              }}
              suppressHead
            />
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="c16-container">
        <section style={{ padding: "56px 0 32px", textAlign: "center" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            {resolved ? `Court 16 · ${resolved.name}` : "Court 16"}
          </div>
          <h1 className="section-title">
            Who&apos;s <em>playing</em>?
          </h1>
          <p className="section-sub">
            Pick the path that fits. Kids trial is free and staff-confirmed; adult intros
            vary by club and open only after the live Mindbody price is verified.
          </p>
          {resolved && (
            <div style={{ marginTop: 14 }}>
              <Link
                href="/"
                className="back-link"
                onClick={(e) => {
                  e.preventDefault();
                  setLocation(null);
                  router.push("/");
                }}
              >
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
              </Link>
            </div>
          )}
        </section>

        <section style={{ padding: "0 0 80px" }}>
          <div
            style={{
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <PathCard
              eyebrow="For your child"
              title="Kids free trial"
              description="Ages 3–17. Browse real classes, pick a time, staff confirms within a few hours."
              cta="Start kids trial"
              href={`/trial${qs}`}
              accentColor="#FFE033"
            />
            <PathCard
              eyebrow="For you"
              title="Adult intro"
              description="Choose an adult offer whose live Mindbody service and price are verified for this club."
              cta="Start adult intro"
              href={`/intro${qs}`}
              accentColor="#1a1a1a"
            />
          </div>
        </section>
      </div>
    </>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <BookInner />
    </Suspense>
  );
}
