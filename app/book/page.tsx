"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import PathCard from "@/components/PathCard";
import { useSelectedLocation } from "@/lib/location-state";
import { getLocationById } from "@/config/locations";

function BookInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { location, setLocation } = useSelectedLocation();
  const urlLocation = params.get("location");

  // Sync URL → global state (e.g. when arriving from the header's
  // post-dropdown redirect).
  useEffect(() => {
    if (urlLocation && !location) {
      const loc = getLocationById(urlLocation);
      if (loc) setLocation(loc);
    }
    // if URL location differs from global, URL wins — matches SoulCycle's
    // deep-link behavior where /studios/NYC switches regions globally.
    if (urlLocation && location && urlLocation !== location.id) {
      const loc = getLocationById(urlLocation);
      if (loc) setLocation(loc);
    }
  }, [urlLocation, location, setLocation]);

  // If no location is set AND no URL param, bounce to / where the nav
  // dropdown prompts. Shouldn't hit this since the nav Book now handles
  // the guard, but belt-and-suspenders.
  useEffect(() => {
    if (!urlLocation && !location) router.replace("/");
  }, [urlLocation, location, router]);

  const resolved = location ?? (urlLocation ? getLocationById(urlLocation) : null);
  const qs = resolved ? `?location=${resolved.id}` : "";

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
            are $58–$75 and book instantly after payment.
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
              description="Tennis Intro Special ($75) or Pickleball Clinic Intro ($58). Book a session and pay online."
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
