"use client";

import type { TrialRequest, TrialSubmissionStatus } from "@/lib/trial-types";

interface Props {
  request: TrialRequest;
  correlationId?: string;
  status: TrialSubmissionStatus;
}

export default function ConfirmationScreen({ request, correlationId, status }: Props) {
  const accountCreated = status === "pending_staff";
  const duplicateReview = status === "duplicate_email_softwall";
  const childName =
    request.children.length > 1
      ? request.children.map((child) => child.firstName).join(" & ")
      : request.childFirstName;

  return (
    <main className="confirmation-shell">
      <section className="confirmation-hero">
        <div className="confirmation-mark" aria-hidden="true">
          ✓
        </div>
        <div className="eyebrow">Trial request received</div>
        <h1>Nice choice. We&apos;ll take it from here.</h1>
        <p>
          We&apos;re checking <strong>{childName}&apos;s</strong> spot in{" "}
          <strong>{request.className.split(" I ")[0]}</strong> on{" "}
          <strong>{request.classDay}</strong> at <strong>{request.classTime}</strong>,{" "}
          <strong>{request.locationName}</strong>.
        </p>
      </section>

      <div className="confirmation-grid">
        <section className="confirmation-card confirmation-card--yellow">
          <div className="eyebrow">{accountCreated ? "Your family account" : "Account review"}</div>
          <h2>{accountCreated ? "One parent login. No child password." : "Don’t create another profile."}</h2>
          {accountCreated ? (
            <ol className="next-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Open the Mindbody email.</strong>
                  <p>
                    Look for a native Mindbody welcome or password email at{" "}
                    <strong>{request.parentEmail}</strong>. Use its secure link to claim the
                    parent account.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Wait for Court 16 to confirm the trial.</strong>
                  <p>Staff checks the requested class and follows up with the final details.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>We&apos;ll help finish the family link if needed.</strong>
                  <p>
                    Staff may ask you to add {request.childFirstName} as a family member and
                    approve one secure Mindbody link. Do not create another child profile or a
                    separate child login.
                  </p>
                </div>
              </li>
            </ol>
          ) : (
            <ol className="next-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Your request needs a quick account check.</strong>
                  <p>
                    {duplicateReview
                      ? "We found an existing Mindbody record and paused automatic account creation to prevent a duplicate."
                      : "Our automation could not finish account setup. Staff will verify what, if anything, was created before making another change."}
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Watch for a Court 16 follow-up.</strong>
                  <p>Staff will verify the family record and confirm the requested trial.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Use Mindbody&apos;s secure link only if it arrives.</strong>
                  <p>
                    An account email is not guaranteed during review. Do not register again,
                    add another child, or create a separate child login.
                  </p>
                </div>
              </li>
            </ol>
          )}
        </section>

        <aside className="confirmation-card confirmation-card--dark">
          <div className="eyebrow">For the first visit</div>
          <h2>Bring the player. We&apos;ve got the gear.</h2>
          <ul className="bring-list">
            <li>Sneakers</li>
            <li>Water bottle</li>
            <li>Arrive 10 minutes early</li>
            <li>Racquet provided</li>
          </ul>
          <a href="https://www.court16.com" className="btn light">
            Back to Court16.com <span aria-hidden="true">↗</span>
          </a>
        </aside>
      </div>

      {correlationId && (
        <p className="confirmation-reference">
          Request reference: <code>{correlationId}</code>
        </p>
      )}
    </main>
  );
}
