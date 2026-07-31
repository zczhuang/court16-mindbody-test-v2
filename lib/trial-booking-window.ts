const HOUR_MS = 60 * 60 * 1000;

/** Ibtissam approval, Jul 31 2026: bookings open seven days before class. */
export const TRIAL_BOOKING_WINDOW_DAYS = 7;

/** Ibtissam approval, Jul 31 2026: require at least 48 hours of notice. */
export const TRIAL_MIN_BOOKING_NOTICE_HOURS = 48;

export type TrialBookingWindowState =
  | {
      status: "not_open";
      opensAtUtc: string;
      closesAtUtc: string;
    }
  | {
      status: "open";
      opensAtUtc: string;
      closesAtUtc: string;
    }
  | {
      status: "closed";
      opensAtUtc: string;
      closesAtUtc: string;
    }
  | { status: "invalid" };

/** Validate Mindbody's timezone-less `YYYY-MM-DDTHH:MM:SS` wall clock. */
export function isValidMindbodyClassStart(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return false;
  const [, y, m, d, hh, mm, ss] = match.map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() + 1 === m &&
    parsed.getUTCDate() === d &&
    parsed.getUTCHours() === hh &&
    parsed.getUTCMinutes() === mm &&
    parsed.getUTCSeconds() === ss
  );
}

/**
 * Resolve booking eligibility from an absolute UTC class start.
 *
 * The caller converts Mindbody's site-local wall clock first. At the exact
 * seven-day opening instant and the exact 48-hour cutoff are both allowed.
 * Booking closes only after fewer than 48 hours remain.
 */
export function getTrialBookingWindowState(
  classStartsAtUtc: string,
  now: Date | number = Date.now(),
): TrialBookingWindowState {
  const classStartMs = Date.parse(classStartsAtUtc);
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(classStartMs) || !Number.isFinite(nowMs)) {
    return { status: "invalid" };
  }

  const opensAtMs = classStartMs - TRIAL_BOOKING_WINDOW_DAYS * 24 * HOUR_MS;
  const closesAtMs = classStartMs - TRIAL_MIN_BOOKING_NOTICE_HOURS * HOUR_MS;
  const window = {
    opensAtUtc: new Date(opensAtMs).toISOString(),
    closesAtUtc: new Date(closesAtMs).toISOString(),
  };

  if (nowMs < opensAtMs) return { status: "not_open", ...window };
  if (nowMs > closesAtMs) return { status: "closed", ...window };
  return { status: "open", ...window };
}

export function formatTrialBookingDateTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return "the posted opening time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function trialBookingWindowMessage(
  state: TrialBookingWindowState,
  timezone: string,
): string | null {
  if (state.status === "open") return null;
  if (state.status === "not_open") {
    return `Booking opens ${formatTrialBookingDateTime(state.opensAtUtc, timezone)}`;
  }
  if (state.status === "closed") {
    return `Booking closed — ${TRIAL_MIN_BOOKING_NOTICE_HOURS}-hour notice required`;
  }
  return "Booking unavailable";
}
