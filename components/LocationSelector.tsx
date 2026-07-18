"use client";

import { LOCATIONS, type Location } from "@/config/locations";
import { TRIAL_CONFIG } from "@/config/trial-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import { getKidsTrialReadiness } from "@/config/kids-trial-readiness";

interface Props {
  selectedId: string | null;
  onSelect: (location: Location) => void;
  /** Use the stricter kids-trial readiness gate instead of general booking readiness. */
  trialOnly?: boolean;
  /** Hide the built-in eyebrow + title + subtitle (used when a parent page provides its own). */
  suppressHead?: boolean;
}

export default function LocationSelector({
  selectedId,
  onSelect,
  trialOnly = false,
  suppressHead,
}: Props) {
  return (
    <section className="loc-section">
      {!suppressHead && (
        <div className="section-head">
          <div className="eyebrow">Step 1 of 3</div>
          <h2 id="trial-step-heading" className="section-title" tabIndex={-1}>
            Start with your club.
          </h2>
          <p className="section-sub">
            Choose a club with online trial times. If your club is still being set up,
            our team can help with the next opening.
          </p>
        </div>
      )}

      <div className="loc-grid">
        {LOCATIONS.map((loc) => {
          const enabled = trialOnly
            ? getKidsTrialReadiness({
                location: loc,
                trialConfig: TRIAL_CONFIG[loc.id],
                pipeline: getDealPipeline(loc.id),
                preferredLocation: getHubspotPreferredLocation(loc.id),
              }).ready
            : loc.publicBookingEnabled;
          const on = enabled && selectedId === loc.id;
          const unavailableReason = trialOnly
            ? loc.trialUnavailableReason
            : "Opening details are being finalized.";
          const cardContent = (
            <>
              <div className="loc-top">
                <span className="state-chip">{loc.state}</span>
                <span className="loc-status" aria-hidden="true">
                  {enabled ? (on ? "Selected" : "Online") : "Setup in progress"}
                </span>
              </div>
              <div className="loc-name">{loc.name}</div>
              <div className="loc-addr">{shortAddress(loc)}</div>
              {!enabled && unavailableReason && (
                <div className="loc-unavailable-reason">{unavailableReason}</div>
              )}
              <div className="loc-foot">
                {enabled ? (
                  <span className="loc-go">
                    {on ? "Selected" : trialOnly ? "See trial classes" : "Choose this club"}
                    <span aria-hidden="true">→</span>
                  </span>
                ) : (
                  <a className="loc-followup" href="https://www.court16.com/contact">
                    Ask our team about trials <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            </>
          );

          if (!enabled) {
            return (
              <article
                key={loc.id}
                className="loc-card is-unavailable"
                aria-label={`${loc.name}: online trial setup in progress`}
              >
                {cardContent}
              </article>
            );
          }

          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => onSelect(loc)}
              aria-pressed={on}
              aria-label={`See trial classes at ${loc.name}`}
              className={`loc-card loc-card--enabled ${on ? "on" : ""}`}
            >
              {cardContent}
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
