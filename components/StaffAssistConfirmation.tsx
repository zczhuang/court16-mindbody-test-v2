"use client";

interface Props {
  firstName: string;
  email: string;
  offerDisplayName: string;
  locationName: string;
  correlationId?: string;
}

/**
 * Confirmation screen for offers with flow="staff_assist" (e.g. Pickleball
 * BOGO). No payment, no instant booking — staff reviews the lead and
 * coordinates the slot directly with the player.
 */
export default function StaffAssistConfirmation({
  firstName,
  email,
  offerDisplayName,
  locationName,
  correlationId,
}: Props) {
  return (
    <div className="max-w-lg mx-auto text-center py-12 px-6">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-c16-yellow flex items-center justify-center text-4xl">
        🎾
      </div>

      <h2 className="text-2xl font-extrabold mb-2">Thanks, {firstName} — we got it!</h2>

      <p className="text-lg text-c16-gray-dark mb-6">
        Our team will reach out shortly to coordinate your{" "}
        <strong>{offerDisplayName}</strong> session at{" "}
        <strong>{locationName}</strong>.
      </p>

      <div className="bg-yellow-50 rounded-xl p-6 text-left mb-6">
        <h3 className="font-bold text-sm mb-3">What happens next:</h3>
        <ol className="space-y-2 text-sm text-c16-gray-dark">
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">1.</span>
            Check your inbox at <strong>{email}</strong> — you&apos;ll get a confirmation
            email within the hour.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">2.</span>
            Our team confirms an open slot, texts or emails you to lock in the
            date and time, and you&apos;re set.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">3.</span>
            Show up 10 minutes early with your partner — we&apos;ll take care of the
            rest.
          </li>
        </ol>
      </div>

      {correlationId && (
        <p className="text-xs text-c16-gray mb-4">
          Reference: <code>{correlationId}</code>
        </p>
      )}

      <a
        href="https://www.court16.com"
        className="text-sm text-c16-gray-dark hover:text-c16-black transition-colors underline"
      >
        Back to Court16.com
      </a>
    </div>
  );
}
