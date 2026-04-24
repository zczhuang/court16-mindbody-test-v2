"use client";

import { ADULT_OFFERS, type AdultOffer } from "@/config/adult-config";

interface Props {
  selectedKey: string | null;
  onSelect: (offer: AdultOffer) => void;
}

export default function OfferPicker({ selectedKey, onSelect }: Props) {
  return (
    <div
      className="loc-grid"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
    >
      {ADULT_OFFERS.map((offer) => {
        const on = selectedKey === offer.key;
        return (
          <button
            key={offer.key}
            type="button"
            onClick={() => onSelect(offer)}
            aria-pressed={on}
            className={`loc-card ${on ? "on" : ""}`}
          >
            <div className="loc-top">
              <span className="state-chip">${offer.priceUsd}</span>
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
            <div className="loc-name">{offer.displayName}</div>
            <div className="loc-addr">{offer.subtitle}</div>
            <div className="loc-foot">
              <span className="loc-go">
                {on ? "Selected" : "Choose this offer"}
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
  );
}
