"use client";

import Link from "next/link";
import { useRef, useState } from "react";

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  /** Accent color for the hover shadow + border highlight. Hex string. */
  accentColor?: string;
}

/**
 * PathCard — landing-page CTA that follows the cursor. On hover:
 * 1. Border snaps to black
 * 2. Shadow offset tracks the cursor (pushed away from cursor)
 * 3. Card tilts very subtly in 3D toward the cursor
 * Mouse-leave returns to resting state.
 */
export default function PathCard({
  eyebrow,
  title,
  description,
  cta,
  href,
  accentColor = "#FFE033",
}: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [hover, setHover] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  function handleMove(e: React.MouseEvent<HTMLAnchorElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Normalized cursor position (-0.5 .. 0.5)
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;

    // Shadow is pushed AWAY from cursor so the card feels lifted toward you
    const shadowX = -nx * 20; // up to 10px either side
    const shadowY = -ny * 20;

    // 3D tilt toward cursor — subtle to stay family-friendly, not showy
    const rotX = ny * 4; // tilt back when cursor is low, forward when high
    const rotY = -nx * 5;

    setStyle({
      transform: `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-2px)`,
      boxShadow: `${shadowX.toFixed(1)}px ${shadowY.toFixed(1)}px 0 ${accentColor}, ${(shadowX / 2).toFixed(1)}px ${(shadowY / 2).toFixed(1)}px 24px rgba(0,0,0,.12)`,
    });
  }

  function reset() {
    setHover(false);
    setStyle({});
  }

  return (
    <Link
      ref={ref}
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "26px 26px 22px",
        background: "#fff",
        border: `2px solid ${hover ? "var(--c16-black)" : "var(--c16-line)"}`,
        borderRadius: "var(--r-xl)",
        color: "var(--c16-black)",
        transition:
          "border-color .15s ease, transform .15s ease, box-shadow .15s ease",
        minHeight: 200,
        transformStyle: "preserve-3d",
        willChange: "transform, box-shadow",
        ...style,
      }}
    >
      <span className="eyebrow">{eyebrow}</span>
      <div
        style={{
          fontFamily: "var(--f-display)",
          fontWeight: 800,
          fontSize: 28,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
        }}
      >
        {title}
      </div>
      <p style={{ color: "var(--c16-ink-3)", margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        {description}
      </p>
      <span
        style={{
          marginTop: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          color: "var(--c16-black)",
        }}
      >
        {cta}
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
    </Link>
  );
}
