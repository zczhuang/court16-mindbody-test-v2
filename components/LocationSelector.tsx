"use client";

import { LOCATIONS, type Location } from "@/config/locations";

interface Props {
  selectedId: string | null;
  onSelect: (location: Location) => void;
  /** Hide the built-in eyebrow + title + subtitle (used when a parent page provides its own). */
  suppressHead?: boolean;
}

export default function LocationSelector({ selectedId, onSelect, suppressHead }: Props) {
  return (
    <section className="loc-section">
      {!suppressHead && (
        <div className="section-head">
          <div className="eyebrow">Step 1 of 2</div>
          <h1 className="section-title">Choose your club</h1>
          <p className="section-sub">
            Six clubs across NY, PA &amp; MA. Pick the one nearest you — we&apos;ll show only the
            classes at that location.
          </p>
        </div>
      )}

      <div className="loc-grid">
        {LOCATIONS.map((loc) => {
          const on = selectedId === loc.id;
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => onSelect(loc)}
              aria-pressed={on}
              className={`loc-card ${on ? "on" : ""}`}
            >
              <div className="loc-top">
                <span className="state-chip">{loc.state}</span>
                <span className="loc-check" aria-hidden="true">
                  {on ? (
                    <svg viewBox="0 0 20 20" width="20" height="20">
                      <circle cx="10" cy="10" r="10" fill="#1a1a1a" />
                      <path
                        d="M5.5 10.5l3 3 6-7"
                        fill="none"
                        stroke="#FFE033"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" width="20" height="20">
                      <circle cx="10" cy="10" r="9.5" fill="none" stroke="#e5e5e5" />
                    </svg>
                  )}
                </span>
              </div>
              <div className="loc-name">{loc.name}</div>
              <div className="loc-addr">{shortAddress(loc)}</div>
              <div className="loc-foot">
                <span className="loc-go">
                  {on ? "Selected" : "Choose this club"}
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    <path
                      d="M2 8h11M9 4l4 4-4 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function shortAddress(loc: Location): string {
  return `${loc.address}, ${loc.city}`;
}
