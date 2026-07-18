import assert from "node:assert/strict";

const moduleUrl = new URL("../lib/mindbody-booking-evidence.ts", import.meta.url).href;
const {
  bookingLedgerMatchesStaffToken,
  findExactActiveClientVisit,
  hasUnsafeMindbodyStateForDeny,
  isFamilyReadyForMindbodyMutation,
  parseCheckoutTrialBookingResponse,
  requiresReadOnlyEnrollmentReconciliation,
} = (await import(moduleUrl)) as typeof import("../lib/mindbody-booking-evidence");

const input = {
  ClientId: "child-10",
  ServiceId: 100328,
  ClassId: 15673,
  CorrelationId: "3d594650-e221-4cf8-9577-aedf089e3866",
};
const activeVisit = {
  Id: 5824,
  ClientId: "child-10",
  SiteId: 5748154,
  LocationId: 1,
  ClassId: 15673,
  ClassScheduleId: 9001,
  ProductId: 100328,
  ServiceId: 3001,
  ServiceName: "Kid's Trial",
  StartDateTime: "2026-07-20T09:00:00",
  Status: "Active",
  LateCancelled: false,
  Missed: false,
};

const checkout = parseCheckoutTrialBookingResponse(
  {
    ShoppingCart: {
      SaleId: 2772,
      CartItems: [{ Item: { Name: "Kid's Trial" } }],
    },
    Classes: [{ Id: 15673, Visits: [activeVisit] }],
  },
  input,
);
assert.equal(checkout.saleId, 2772);
assert.equal(checkout.serviceName, "Kid's Trial");
assert.equal(checkout.visit?.Id, 5824);
assert.equal(
  parseCheckoutTrialBookingResponse(
    { Classes: [{ Id: 15673, Visits: [{ ...activeVisit, Id: 0 }] }] },
    input,
  ).visit,
  undefined,
);

const criteria = {
  clientId: "child-10",
  siteId: 5748154,
  locationId: 1,
  classId: 15673,
  productId: 100328,
  serviceName: "Kid's Trial",
  clientServiceId: 3001,
};
assert.equal(findExactActiveClientVisit([activeVisit], criteria)?.Id, 5824);

for (const invalid of [
  { ...activeVisit, ClientId: "other-child" },
  { ...activeVisit, Id: undefined },
  { ...activeVisit, Id: 0 },
  { ...activeVisit, Id: -1 },
  { ...activeVisit, SiteId: 135479 },
  { ...activeVisit, LocationId: 2 },
  { ...activeVisit, ClassId: 999 },
  { ...activeVisit, ProductId: 999 },
  { ...activeVisit, ServiceId: 999 },
  { ...activeVisit, LateCancelled: true },
  { ...activeVisit, Missed: true },
  { ...activeVisit, WaitlistEntryId: 123 },
  { ...activeVisit, Status: "Canceled" },
]) {
  assert.equal(findExactActiveClientVisit([invalid], criteria), undefined);
}

const safeLedger = {
  bookingKey: "request-1",
  correlationId: "request-1",
  intent: "kid_trial",
  familyProvisioningStatus: "child_created",
  enrollmentStatus: "not_started",
  mindbodyMutationStatus: "not_started",
};
assert.equal(bookingLedgerMatchesStaffToken(safeLedger, "request-1"), true);
assert.equal(
  bookingLedgerMatchesStaffToken({ ...safeLedger, bookingKey: "another-request" }, "request-1"),
  false,
);
assert.equal(bookingLedgerMatchesStaffToken(safeLedger, "another-token"), false);
assert.equal(isFamilyReadyForMindbodyMutation(safeLedger), true);
assert.equal(
  isFamilyReadyForMindbodyMutation({ ...safeLedger, familyProvisioningStatus: "child_create_started" }),
  false,
);
assert.equal(
  isFamilyReadyForMindbodyMutation({ ...safeLedger, intent: "adult_intro", familyProvisioningStatus: undefined }),
  true,
);

for (const unresolved of [
  { enrollmentStatus: "enrollment_started", mindbodyMutationStatus: "not_started" },
  { enrollmentStatus: "not_started", mindbodyMutationStatus: "add_to_class_started" },
  { enrollmentStatus: "reconciliation_required", mindbodyMutationStatus: "not_started" },
  { enrollmentStatus: "not_started", mindbodyMutationStatus: "reconciliation_required" },
]) {
  assert.equal(requiresReadOnlyEnrollmentReconciliation(unresolved), true);
  assert.equal(hasUnsafeMindbodyStateForDeny({ ...safeLedger, ...unresolved }), true);
}
assert.equal(requiresReadOnlyEnrollmentReconciliation(safeLedger), false);
assert.equal(hasUnsafeMindbodyStateForDeny(safeLedger), false);
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    ...safeLedger,
    enrollmentStatus: "service_verified",
    mindbodyMutationStatus: "not_started",
  }),
  false,
);
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    ...safeLedger,
    enrollmentStatus: "enrollment_verified",
    mindbodyMutationStatus: "verified",
  }),
  true,
);
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    ...safeLedger,
    enrollmentStatus: "checkout_started",
    mindbodyMutationStatus: "checkout_started",
  }),
  true,
);
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    ...safeLedger,
    enrollmentStatus: "not_started",
    mindbodyMutationStatus: "manual_review",
  }),
  true,
);

// Intake-stage manual_review Deals never started a checkout or enrollment, so
// they must stay deniable: staff denial is the release path for the parent's
// active-booking fence.
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    intent: "kid_trial",
    familyProvisioningStatus: "not_started",
    enrollmentStatus: "not_started",
    mindbodyMutationStatus: "not_started",
  }),
  false,
);
assert.equal(hasUnsafeMindbodyStateForDeny(safeLedger), false);
// A half-provisioned or reconciliation-flagged family means Mindbody records
// may exist that the Deal cannot account for; releasing the fence could let a
// resubmission duplicate a child, so denial stays blocked.
for (const unsettled of [
  "parent_create_started",
  "parent_created",
  "child_create_started",
  "reconciliation_required",
] as const) {
  assert.equal(
    hasUnsafeMindbodyStateForDeny({
      intent: "kid_trial",
      familyProvisioningStatus: unsettled,
      enrollmentStatus: "not_started",
      mindbodyMutationStatus: "not_started",
    }),
    true,
  );
}
// Kid trials with no recorded provisioning state fail closed.
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    intent: "kid_trial",
    familyProvisioningStatus: undefined,
    enrollmentStatus: "not_started",
    mindbodyMutationStatus: "not_started",
  }),
  true,
);
// Adult intros have no family provisioning; pre-write states stay deniable.
assert.equal(
  hasUnsafeMindbodyStateForDeny({
    intent: "adult_intro",
    familyProvisioningStatus: undefined,
    enrollmentStatus: "not_started",
    mindbodyMutationStatus: "not_started",
  }),
  false,
);

const mindbodyModuleUrl = new URL("../lib/mindbody.ts", import.meta.url).href;
const { buildCheckoutTrialBookingBody, getClientServices } = (await import(mindbodyModuleUrl)) as typeof import("../lib/mindbody");
const checkoutBody = buildCheckoutTrialBookingBody({ ...input, LocationId: 1 });
assert.equal(checkoutBody.LocationId, 1);
assert.equal(checkoutBody.EnforceLocationRestrictions, true);
assert.deepEqual(checkoutBody.Items[0].ClassIds, [input.ClassId]);
assert.throws(
  () => buildCheckoutTrialBookingBody({ ...input, LocationId: 0 }),
  /positive Mindbody LocationId/,
);
const cfg = {
  apiKey: "offline-test-key",
  siteId: "5748154",
  baseUrl: "https://offline.invalid/public/v6",
  staffUsername: "offline",
  staffPassword: "offline",
  writeMode: "test" as const,
};
const noop = () => undefined;
const log = {
  correlationId: "offline-pagination-test",
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
} as Parameters<typeof getClientServices>[1];
const originalFetch = globalThis.fetch;
const originalSourcePassword = process.env.MINDBODY_SOURCE_PASSWORD;
delete process.env.MINDBODY_SOURCE_PASSWORD;

try {
  const requestedUrls: URL[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requestedUrls.push(url);
    const offset = Number(url.searchParams.get("Offset"));
    const payload =
      offset === 0
        ? {
            ClientServices: [{ Id: 1 }, { Id: 2 }],
            PaginationResponse: {
              RequestedLimit: 200,
              RequestedOffset: 0,
              PageSize: 2,
              TotalResults: 3,
            },
          }
        : {
            ClientServices: [{ Id: 3 }],
            PaginationResponse: {
              RequestedLimit: 200,
              RequestedOffset: 2,
              PageSize: 1,
              TotalResults: 3,
            },
          };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const services = await getClientServices(cfg, log, "child-10");
  assert.deepEqual(services.map((service) => service.Id), [1, 2, 3]);
  assert.deepEqual(
    requestedUrls.map((url) => url.searchParams.get("Offset")),
    ["0", "2"],
  );
  for (const url of requestedUrls) {
    assert.equal(url.searchParams.get("ClientId"), "child-10");
    assert.equal(url.searchParams.get("StartDate"), "2000-01-01");
    assert.equal(url.searchParams.get("EndDate"), "2100-01-01");
    assert.equal(url.searchParams.get("CrossRegionalLookup"), "true");
    assert.equal(url.searchParams.get("Limit"), "200");
  }

  let cappedCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const offset = Number(url.searchParams.get("Offset"));
    cappedCalls += 1;
    return new Response(
      JSON.stringify({
        ClientServices: Array.from({ length: 200 }, (_, index) => ({ Id: offset + index + 1 })),
        PaginationResponse: {
          RequestedLimit: 200,
          RequestedOffset: offset,
          PageSize: 200,
          TotalResults: 2001,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  await assert.rejects(
    () => getClientServices(cfg, log, "child-over-cap"),
    /exceeded the safe pagination cap/,
  );
  assert.equal(cappedCalls, 10);
} finally {
  globalThis.fetch = originalFetch;
  if (originalSourcePassword === undefined) {
    delete process.env.MINDBODY_SOURCE_PASSWORD;
  } else {
    process.env.MINDBODY_SOURCE_PASSWORD = originalSourcePassword;
  }
}

console.log("Mindbody checkout and exact Visit evidence contract passed.");
