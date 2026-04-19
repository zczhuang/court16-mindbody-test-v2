"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LOCATIONS,
  getLoginUrlFor,
  type Location,
} from "@/config/locations";

type OpenMenu = null | "book" | "signin";

export default function Header() {
  const router = useRouter();
  const [open, setOpen] = useState<OpenMenu>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const signInRef = useRef<HTMLDivElement>(null);

  // Close any open menu on outside click or Esc.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (bookRef.current?.contains(t) || signInRef.current?.contains(t)) return;
      setOpen(null);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function handleBookPick(loc: Location) {
    setOpen(null);
    router.push(`/book?location=${loc.id}`);
  }

  return (
    <header className="c16-header">
      <div className="c16-header-inner">
        <Link href="/" className="c16-logo">
          <span className="ball" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="36" height="36">
              <circle cx="20" cy="20" r="19" fill="#FFE033" stroke="#1a1a1a" strokeWidth="2" />
              <path d="M3 20 Q20 6 37 20" fill="none" stroke="#1a1a1a" strokeWidth="1.5" opacity=".55" />
              <path d="M3 20 Q20 34 37 20" fill="none" stroke="#1a1a1a" strokeWidth="1.5" opacity=".55" />
            </svg>
          </span>
          <span className="wordmark">COURT 16</span>
          <span className="tag">Tennis Remixed</span>
        </Link>

        <nav className="c16-nav">
          <div ref={signInRef} className="nav-item">
            <button
              type="button"
              className="link nav-trigger"
              aria-expanded={open === "signin"}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => (o === "signin" ? null : "signin"))}
            >
              Sign in
              <Chevron />
            </button>
            {open === "signin" && (
              <LocationMenuPanel
                heading="Sign in at your club"
                align="right"
                renderItem={(loc) => (
                  <a
                    key={loc.id}
                    className="nav-menu-item"
                    href={getLoginUrlFor(loc)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(null)}
                  >
                    <span className="nav-menu-name">{loc.name}</span>
                    <span className="nav-menu-addr">{loc.address}</span>
                  </a>
                )}
              />
            )}
          </div>

          <div ref={bookRef} className="nav-item">
            <button
              type="button"
              className="pill yellow nav-trigger"
              aria-expanded={open === "book"}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => (o === "book" ? null : "book"))}
            >
              Book now
              <Chevron />
            </button>
            {open === "book" && (
              <LocationMenuPanel
                heading="Pick your club"
                align="right"
                renderItem={(loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    className="nav-menu-item"
                    onClick={() => handleBookPick(loc)}
                  >
                    <span className="nav-menu-name">{loc.name}</span>
                    <span className="nav-menu-addr">{loc.address}</span>
                  </button>
                )}
              />
            )}
          </div>
        </nav>
      </div>

      <style jsx>{`
        .nav-item { position: relative; }
        .nav-trigger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          border: 0;
        }
        .nav-trigger.link {
          padding: 8px 12px;
          border-radius: 999px;
          background: transparent;
          color: var(--c16-ink-2);
        }
        .nav-trigger.link:hover {
          background: var(--c16-paper-2);
          color: var(--c16-black);
        }
        .nav-trigger.link[aria-expanded="true"] {
          background: var(--c16-paper-2);
          color: var(--c16-black);
        }
      `}</style>
    </header>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path
        d="M2 4l3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LocationMenuPanel({
  heading,
  align,
  renderItem,
}: {
  heading: string;
  align: "left" | "right";
  renderItem: (loc: Location) => React.ReactNode;
}) {
  const byState = LOCATIONS.reduce<Record<string, Location[]>>((acc, l) => {
    if (!acc[l.state]) acc[l.state] = [];
    acc[l.state].push(l);
    return acc;
  }, {});

  return (
    <div role="menu" className={`nav-menu ${align}`}>
      <div className="nav-menu-heading-top">{heading}</div>
      {Object.entries(byState).map(([state, locs]) => (
        <div key={state} className="nav-menu-group">
          <div className="nav-menu-state">{state}</div>
          {locs.map((loc) => renderItem(loc))}
        </div>
      ))}

      <style jsx>{`
        .nav-menu {
          position: absolute;
          top: calc(100% + 8px);
          min-width: 300px;
          background: #fff;
          border: 1.5px solid var(--c16-line);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-pop);
          padding: 12px 10px 10px;
          z-index: 60;
          display: grid;
          gap: 4px;
        }
        .nav-menu.right { right: 0; }
        .nav-menu.left { left: 0; }
        @media (max-width: 520px) {
          .nav-menu { min-width: 260px; right: -16px; }
        }
        .nav-menu-heading-top {
          font-family: var(--f-mono);
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--c16-ink-3);
          font-weight: 600;
          padding: 2px 10px 8px;
          border-bottom: 1px solid var(--c16-line);
          margin-bottom: 4px;
        }
        .nav-menu-group { display: grid; gap: 2px; }
        .nav-menu-state {
          font-family: var(--f-mono);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--c16-ink-4);
          font-weight: 600;
          padding: 8px 10px 2px;
        }
        :global(.nav-menu .nav-menu-item) {
          display: block;
          text-align: left;
          width: 100%;
          padding: 9px 12px;
          border: 0;
          background: transparent;
          border-radius: var(--r-md);
          cursor: pointer;
          transition: background 0.12s ease;
          text-decoration: none;
          color: var(--c16-black);
        }
        :global(.nav-menu .nav-menu-item:hover) {
          background: var(--c16-paper-2);
        }
        :global(.nav-menu .nav-menu-name) {
          display: block;
          font-family: var(--f-display);
          font-weight: 700;
          font-size: 14px;
          letter-spacing: -0.02em;
          color: var(--c16-black);
          line-height: 1.2;
        }
        :global(.nav-menu .nav-menu-addr) {
          display: block;
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--c16-ink-3);
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}
