"use client";

import { useEffect, useState } from "react";
import { getLocationById, type Location } from "@/config/locations";

const STORAGE_KEY = "c16-selected-location";

/**
 * Global selected-location state, backed by localStorage so the nav chip
 * persists across pages and reloads. Mirrors SoulCycle's pattern where
 * the top-nav 📍 chip is authoritative and pages filter by it.
 */
export function useSelectedLocation(): {
  location: Location | null;
  setLocation: (loc: Location | null) => void;
} {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSlug(stored);
    } catch {
      // localStorage not available (SSR, private browsing)
    }
  }, []);

  function setLocation(loc: Location | null) {
    const next = loc?.id ?? null;
    setSlug(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    // Notify other components that read this via a custom event.
    window.dispatchEvent(new CustomEvent("c16-location-change", { detail: next }));
  }

  // Listen for changes from other components / tabs
  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<string | null>).detail ?? null;
      setSlug(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setSlug(e.newValue);
    }
    window.addEventListener("c16-location-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("c16-location-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const location = slug ? (getLocationById(slug) ?? null) : null;
  return { location, setLocation };
}
