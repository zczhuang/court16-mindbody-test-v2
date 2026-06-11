"use client";

import { useEffect, useRef, useState } from "react";

interface AuthUser {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  homeLocationId: number | null;
}

export default function MindbodyLoginButton({ returnTo }: { returnTo?: string }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated) setUser(data.user as AuthUser);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (loading) {
    return <span className="mb-login-btn mb-login-btn--loading" aria-busy>· · ·</span>;
  }

  if (!user) {
    const href = `/auth/mindbody/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ""}`;
    return (
      <a className="mb-login-btn" href={href}>
        Sign in with MindBody
      </a>
    );
  }

  const initial = (user.firstName || user.email || "?").charAt(0).toUpperCase();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div ref={ref} className="mb-login-user" style={{ position: "relative" }}>
      <button
        type="button"
        className="mb-login-user__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="mb-login-user__avatar" aria-hidden>{initial}</span>
        <span className="mb-login-user__name">{name}</span>
      </button>
      {open && (
        <div className="mb-login-user__menu" role="menu">
          <div className="mb-login-user__email">{user.email}</div>
          <a className="mb-login-user__item" href="/auth/mindbody/logout" role="menuitem">
            Log out
          </a>
        </div>
      )}
    </div>
  );
}
