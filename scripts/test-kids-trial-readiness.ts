import assert from "node:assert/strict";
import type { DealPipelineConfig } from "../config/hubspot-deals";
import { LOCATIONS, type Location } from "../config/locations.ts";
import type { LocationTrialConfig } from "../config/trial-config";

const readinessModuleUrl = new URL("../config/kids-trial-readiness.ts", import.meta.url).href;
const {
  getKidsTrialCalendarPreviewReadiness,
  getKidsTrialReadiness,
  getKidsTrialStaffReadiness,
} = (await import(readinessModuleUrl)) as typeof import("../config/kids-trial-readiness");

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
    hubspotDealLedgerVerified: true,
    durableMutationLockVerified: true,
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

  // Browse-only calendar preview: strictly weaker than public readiness and
  // never implied by it — the flag must be explicit, and preview never makes
  // a club publicly ready.
  const previewOff = getKidsTrialCalendarPreviewReadiness({ location });
  assert.equal(previewOff.ready, false);
  if (!previewOff.ready) assert(previewOff.missing.includes("calendar_preview_enabled"));

  const previewLocation: Location = { ...location, trialCalendarPreviewEnabled: true };
  const previewOn = getKidsTrialCalendarPreviewReadiness({ location: previewLocation });
  assert.equal(previewOn.ready, true);
  if (previewOn.ready) {
    assert.equal(previewOn.scope, "trial_program");
    assert.deepEqual(previewOn.programIds, [61]);
  }

  // Preview does not unlock the public flow: the same club still fails the
  // full readiness gate.
  const previewStillNotPublic = getKidsTrialReadiness({
    location: previewLocation,
    trialConfig,
    pipeline,
    preferredLocation: "Test - New York",
  });
  assert.equal(previewStillNotPublic.ready, false);

  // Preview always requires dated site authorization.
  const previewUnauthorized = getKidsTrialCalendarPreviewReadiness({
    location: {
      ...previewLocation,
      trialLaunchEvidence: { ...previewLocation.trialLaunchEvidence!, mindbodySiteAuthorized: false },
    },
  });
  assert.equal(previewUnauthorized.ready, false);
  if (!previewUnauthorized.ready) {
    assert(previewUnauthorized.missing.includes("mindbody_site_authorized"));
  }
  // Without a dedicated trial Program, preview switches to a separate,
  // read-only regular-kids schedule using only the explicit site allowlist.
  const kidsSchedulePreview = getKidsTrialCalendarPreviewReadiness({
    location: {
      ...previewLocation,
      kidTrialProgramId: undefined,
      kidsCalendarProgramIds: [76, 70, 76, -1],
    },
  });
  assert.equal(kidsSchedulePreview.ready, true);
  if (kidsSchedulePreview.ready) {
    assert.equal(kidsSchedulePreview.scope, "kids_schedule");
    assert.deepEqual(kidsSchedulePreview.programIds, [76, 70]);
  }

  // An authorized, explicitly enabled club with no live kids Program still
  // gets the calendar shell and an honest empty state; it never broad-queries.
  const emptySchedulePreview = getKidsTrialCalendarPreviewReadiness({
    location: {
      ...previewLocation,
      kidTrialProgramId: undefined,
      kidsCalendarProgramIds: [],
    },
  });
  assert.equal(emptySchedulePreview.ready, true);
  if (emptySchedulePreview.ready) {
    assert.equal(emptySchedulePreview.scope, "kids_schedule");
    assert.deepEqual(emptySchedulePreview.programIds, []);
  }

  // A $0 Service is still mandatory for booking, but irrelevant to a GET-only
  // dedicated trial calendar preview.
  const previewWithoutService = getKidsTrialCalendarPreviewReadiness({
    location: previewLocation,
  });
  assert.equal(previewWithoutService.ready, true);

  // Production configuration: Program 120 is site-scoped to six clubs with
  // verified live occurrences. Ridge Hill remains on its established Program
  // 61. Every club stays preview-only until the independent launch gates pass.
  const expectedProgramIds: Record<string, number | undefined> = {
    brooklyn: 120,
    lic: 120,
    fidi: 120,
    ridgehill: 61,
    fishtown: 120,
    newton: 120,
    allston: 120,
  };
  const inventoryVerified = new Set([
    "brooklyn",
    "lic",
    "fidi",
    "ridgehill",
    "fishtown",
    "newton",
    "allston",
  ]);

  for (const configuredLocation of LOCATIONS) {
    const expectedProgramId = expectedProgramIds[configuredLocation.id];
    assert.equal(configuredLocation.kidTrialProgramId, expectedProgramId);
    assert.equal(configuredLocation.trialBookingEnabled, false);
    assert.equal(
      configuredLocation.trialLaunchEvidence?.upcomingTrialInventoryVerified,
      inventoryVerified.has(configuredLocation.id),
    );

    const configuredPreview = getKidsTrialCalendarPreviewReadiness({
      location: configuredLocation,
    });
    assert.equal(configuredPreview.ready, true);
    if (!configuredPreview.ready) continue;

    if (expectedProgramId != null) {
      assert.equal(configuredPreview.scope, "trial_program");
      assert.deepEqual(configuredPreview.programIds, [expectedProgramId]);
    }
  }
} finally {
  if (originalPublicLaunch === undefined) {
    delete process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED = originalPublicLaunch;
  }
}

console.log("Kids trial public/staff readiness isolation passed.");
