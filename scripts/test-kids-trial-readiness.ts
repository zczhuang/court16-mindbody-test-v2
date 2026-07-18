import assert from "node:assert/strict";
import type { DealPipelineConfig } from "../config/hubspot-deals";
import type { Location } from "../config/locations";
import type { LocationTrialConfig } from "../config/trial-config";

const readinessModuleUrl = new URL("../config/kids-trial-readiness.ts", import.meta.url).href;
const { getKidsTrialReadiness, getKidsTrialStaffReadiness } = (await import(
  readinessModuleUrl
)) as typeof import("../config/kids-trial-readiness");

const location: Location = {
  id: "readiness-test",
  name: "Readiness Test",
  fullName: "NY - Readiness Test",
  siteId: 12345,
  address: "1 Test Street",
  city: "Brooklyn",
  state: "NY",
  postalCode: "11201",
  timezone: "America/New_York",
  publicBookingEnabled: false,
  trialBookingEnabled: false,
  kidTrialProgramId: 61,
  trialLaunchEvidence: {
    mindbodySiteAuthorized: true,
    upcomingTrialInventoryVerified: false,
    hubspotRoutingVerified: false,
    endToEndAcceptancePassed: true,
    designOwnerApproved: false,
    reviewedAt: "2026-07-18",
  },
};

const trialConfig: LocationTrialConfig = {
  trialEligibleClassScheduleIds: [],
  maxTrialsPerClass: 2,
  trialServiceId: 100328,
  trialServiceName: "Kid's Trial",
  parentGuardianRelationship: {
    Id: -6,
    RelationshipName1: "Parent/Guardian",
    RelationshipName2: "Child",
  },
  mindbodyGenderOptions: ["Female", "Male", "Undisclosed"],
};

const pipeline: DealPipelineConfig = {
  pipelineId: "pipeline-test",
  stages: { requested: "requested", scheduled: "scheduled" },
};

const originalPublicLaunch = process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED;
delete process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED;

try {
  const publicReadiness = getKidsTrialReadiness({
    location,
    trialConfig,
    pipeline,
    preferredLocation: "Readiness Test",
  });
  assert.equal(publicReadiness.ready, false);
  if (!publicReadiness.ready) {
    assert(publicReadiness.missing.includes("public_launch_enabled"));
    assert(publicReadiness.missing.includes("public_booking_enabled"));
    assert(publicReadiness.missing.includes("trial_booking_enabled"));
    assert(publicReadiness.missing.includes("upcoming_trial_inventory_verified"));
    assert(publicReadiness.missing.includes("design_owner_approved"));
  }

  // Stopping new public intake must not disable completion of an already
  // accepted request when operational evidence and the server write gate are
  // still valid.
  assert.equal(getKidsTrialStaffReadiness({ location, trialConfig, pipeline }).ready, true);

  const revoked = getKidsTrialStaffReadiness({
    location: {
      ...location,
      trialLaunchEvidence: {
        ...location.trialLaunchEvidence!,
        mindbodySiteAuthorized: false,
      },
    },
    trialConfig,
    pipeline,
  });
  assert.equal(revoked.ready, false);
  if (!revoked.ready) assert(revoked.missing.includes("mindbody_site_authorized"));
} finally {
  if (originalPublicLaunch === undefined) {
    delete process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED = originalPublicLaunch;
  }
}

console.log("Kids trial public/staff readiness isolation passed.");
