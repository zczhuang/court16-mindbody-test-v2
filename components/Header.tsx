"use client";

import Link from "next/link";

export default function Header() {
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
          <Link className="pill yellow" href="/">Book now</Link>
          <a
            href="https://court-16-online-enrollment.onrender.com/enroll"
            className="link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Enroll
          </a>
          <span className="divider" />
          <a
            href="https://www.court16.com/adults"
            className="link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Adults
          </a>
          <a
            href="https://clients.mindbodyonline.com/ASP/main_class.asp"
            className="link"
            target="_blank"
            rel="noopener noreferrer"
          >
            My Account
          </a>
        </nav>
      </div>
    </header>
  );
}
