import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TrialE2EHarness from "@/components/TrialE2EHarness";
import { getTrialE2EPolicy, isTrialE2EHostAllowed } from "@/lib/trial-e2e/policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trial Automation E2E | Court 16",
  description: "Protected, isolated acceptance flow for Court 16 trial automation.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TrialE2EPage() {
  const requestHeaders = await headers();
  if (
    !getTrialE2EPolicy().allowed ||
    !isTrialE2EHostAllowed(requestHeaders.get("host"))
  ) {
    notFound();
  }
  return <TrialE2EHarness />;
}
