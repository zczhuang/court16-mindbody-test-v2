"use client";

/**
 * Drops the redesign's nav + chatbot launcher into any Next.js route.
 *
 * Reuses /redesign/styles.css + /redesign/app.js as the single source of
 * truth — the script injects the nav into <div id="site-nav"> and the
 * chatbot launcher into <body> on its own. Mount this component once at
 * the top of a page (typically replaces the existing <Header />).
 *
 * NOTE: paths inside NAV_HTML are absolute (/redesign/*) so the menu
 * works correctly when rendered from /trial or any other route.
 */

import { useEffect } from "react";

const ASSET_VERSION = "7";

export default function RedesignChrome() {
  useEffect(() => {
    // Inject the redesign stylesheet (once)
    if (!document.querySelector("link[data-redesign-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/redesign/styles.css?v=${ASSET_VERSION}`;
      link.dataset.redesignCss = "true";
      document.head.appendChild(link);
    }
    // Inject the redesign script (once). It auto-runs injectChrome()
    // on DOMContentLoaded — but if we're already past that, fire it
    // manually after load.
    if (!document.querySelector("script[data-redesign-js]")) {
      const script = document.createElement("script");
      script.src = `/redesign/app.js?v=${ASSET_VERSION}`;
      script.dataset.redesignJs = "true";
      script.onload = () => {
        // Script's DOMContentLoaded listener won't fire if we attach late.
        // Call the global injector manually.
        const w = window as unknown as {
          injectChrome?: () => void;
          applyLocation?: () => void;
        };
        if (typeof w.injectChrome === "function") w.injectChrome();
        if (typeof w.applyLocation === "function") w.applyLocation();
      };
      document.body.appendChild(script);
    }
  }, []);

  return (
    <>
      {/* Mount point — app.js injects the full nav header into here */}
      <div id="site-nav" />
      {/* Chatbot launcher + slide-in panel get appended to <body> directly */}
    </>
  );
}
