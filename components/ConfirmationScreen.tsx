"use client";

import type { TrialRequest } from "@/lib/trial-types";

interface Props {
  request: TrialRequest;
  correlationId?: string;
}

export default function ConfirmationScreen({ request, correlationId }: Props) {
  const enrollUrl = `https://court-16-online-enrollment.onrender.com/enroll?location=${request.locationId}`;

  return (
    <div className="max-w-lg mx-auto text-center py-12 px-6">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-c16-yellow flex items-center justify-center text-4xl">
        🎾
      </div>

      <h2 className="text-2xl font-extrabold mb-2">You&apos;re in!</h2>

      <p className="text-lg text-c16-gray-dark mb-6">
        We&apos;re confirming{" "}
        <strong>
          {request.children.length > 1
            ? request.children.map((c) => c.firstName).join(" & ")
            : request.childFirstName}
        </strong>
        &apos;s spot in{" "}
        <strong>{request.className.split(" I ")[0]}</strong> on{" "}
        <strong>{request.classDay}</strong> at{" "}
        <strong>{request.classTime}</strong> at{" "}
        <strong>{request.locationName}</strong>.
      </p>

      {request.children.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 text-left">
          <h4 className="font-bold text-xs text-c16-gray-dark uppercase mb-2">
            Trial requested for:
          </h4>
          {request.children.map((child, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-1">
              <span className="w-6 h-6 rounded-full bg-c16-yellow flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              <span>
                <strong>{child.firstName}</strong> (age {child.age})
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-yellow-50 rounded-xl p-6 text-left mb-6">
        <h3 className="font-bold text-sm mb-3">What happens next:</h3>
        <ol className="space-y-2 text-sm text-c16-gray-dark">
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">1.</span>
            Check your inbox — we just sent you a confirmation email at{" "}
            <strong>{request.parentEmail}</strong>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">2.</span>
            Our team will confirm the class spot within a few hours
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-c16-black">3.</span>
            You&apos;ll get a final confirmation with everything you need to know — what
            to bring, where to go, and who {request.childFirstName}&apos;s coach will be
          </li>
        </ol>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-sm text-c16-gray-dark mb-6">
        <p>
          <strong>What to bring:</strong> Sneakers, water bottle, and a smile. We provide the racquet! Arrive 10 minutes early.
        </p>
      </div>

      <div className="bg-white rounded-xl border-2 border-c16-yellow p-6 mb-8">
        <h3 className="font-bold text-base mb-2">
          Ready to enroll {request.childFirstName} for the full season?
        </h3>
        <p className="text-sm text-c16-gray-dark mb-4">
          After the trial, you can enroll directly into {request.childFirstName}&apos;s level at{" "}
          {request.locationName.split(" - ").pop()}.
        </p>
        <a
          href={enrollUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-3 bg-c16-black text-white rounded-xl font-semibold text-sm hover:bg-c16-dark transition-colors"
        >
          View Season Enrollment &rarr;
        </a>
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
