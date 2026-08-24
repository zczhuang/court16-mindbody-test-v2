import assert from "node:assert/strict";

const ledgerModuleUrl = new URL("../lib/hubspot-deal-ledger.ts", import.meta.url).href;
const bookingIdentityModuleUrl = new URL("../lib/booking-identity.ts", import.meta.url).href;
const { buildActiveParentKey } = (await import(bookingIdentityModuleUrl)) as typeof import("../lib/booking-identity");
const {
  HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS,
  HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES,
  HUBSPOT_BOOKING_LEDGER_VERSION,
  buildBookingDealProperties,
  HubspotDealConflictError,
  parseBookingDealLedger,
  assertExistingTrialDealMatches,
  validateBookingDealLedgerForState,
} = (await import(ledgerModuleUrl)) as typeof import("../lib/hubspot-deal-ledger");

const properties = buildBookingDealProperties({
  correlationId: "c16-ledger-test",
  activeParentKey: buildActiveParentKey(" Parent@Example.com "),
  intent: "kid_trial",
  bookingStatus: "pending_staff",
  testRecord: "true",
  locationSlug: "ridgehill",
  mindbodySiteId: 5748154,
  mindbodyLocationId: 1,
  mindbodyProgramId: 61,
  mindbodyServiceId: 100328,
  mindbodyServiceName: "Kid's Trial",
  classId: 15673,
  classScheduleId: 9001,
  className: "Freshman Trial",
  classDayTime: "Saturday, July 18 at 9:00 AM",
  coachName: "Coach Test",
  parentEmail: " Parent@Example.com ",
  childFirstName: "Alex",
  childLastName: "Example",
  childBirthDate: "2018-04-02",
  waiverVersion: "v1.0",
  staffConfirmUrl: "https://example.com/confirm",
  staffReassignUrl: "https://example.com/reassign",
  staffDenyUrl: "https://example.com/deny",
  mindbodyParentId: "1001",
  mindbodyChildId: "1002",
  familyAccountStatus: "parent_claim_pending",
  familyProvisioningStatus: "child_created",
  familyProvisioningStartedAt: "2026-07-18T14:28:00.000Z",
  enrollmentStatus: "enrollment_started",
  mindbodyMutationStatus: "add_to_class_started",
  mindbodyMutationStartedAt: "2026-07-18T14:29:00.000Z",
  mindbodyClientServiceId: 3001,
  mindbodySaleId: 4001,
  mindbodyVisitId: 0,
  enrollmentVerifiedAt: "2026-07-18T14:30:00.000Z",
});

assert.equal(properties.court16_booking_ledger_version, HUBSPOT_BOOKING_LEDGER_VERSION);
assert.equal(properties.court16_booking_key, "c16-ledger-test");
assert.equal(properties.court16_test_record, "true");
assert.equal(
  properties.court16_active_parent_key,
  buildActiveParentKey("parent@example.com"),
);
assert(!properties.court16_active_parent_key?.includes("parent@example.com"));
assert.equal(properties.court16_parent_email, "parent@example.com");
assert.equal(properties.court16_mindbody_site_id, "5748154");
assert.equal(properties.court16_mindbody_location_id, "1");
assert.equal(properties.court16_mindbody_sale_id, "4001");
assert.equal(properties.court16_mindbody_visit_id, undefined);
assert.equal(properties.court16_child_birth_date, String(Date.parse("2018-04-02T00:00:00.000Z")));
assert.equal(properties.court16_enrollment_verified_at, String(Date.parse("2026-07-18T14:30:00.000Z")));
assert.equal(
  properties.court16_family_provisioning_started_at,
  String(Date.parse("2026-07-18T14:28:00.000Z")),
);

const parsed = parseBookingDealLedger({ ...properties, class_date: "1784385000000" });
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.value.locationSlug, "ridgehill");
  assert.equal(parsed.value.testRecord, "true");
  assert.equal(parsed.value.mindbodyChildId, "1002");
  assert.equal(parsed.value.classDate, "1784385000000");
  assert.equal(parsed.value.enrollmentStatus, "enrollment_started");
  assert.equal(parsed.value.mindbodyMutationStatus, "add_to_class_started");
  assert.equal(parsed.value.familyProvisioningStatus, "child_created");
  assert.deepEqual(validateBookingDealLedgerForState(parsed.value), []);
}

const reparsedEpoch = buildBookingDealProperties({
  ...(parsed.ok ? parsed.value : ({} as never)),
  bookingStatus: "confirmed",
});
assert.equal(reparsedEpoch.court16_enrollment_verified_at, properties.court16_enrollment_verified_at);

const incomplete = parseBookingDealLedger({ court16_booking_ledger_version: "1" });
assert.equal(incomplete.ok, false);
if (!incomplete.ok) {
  assert(incomplete.missing.includes("court16_correlation_id"));
  assert(incomplete.missing.includes("court16_mindbody_site_id"));
}

const mismatchedKey = parseBookingDealLedger({
  ...properties,
  court16_booking_key: "different-key",
});
assert.equal(mismatchedKey.ok, false);
if (!mismatchedKey.ok) {
  assert(mismatchedKey.missing.includes("court16_booking_key=court16_correlation_id"));
}

const pendingWithoutCompletedFamily = parseBookingDealLedger({
  ...properties,
  court16_family_provisioning_status: "parent_created",
  class_date: "1784385000000",
});
assert.equal(pendingWithoutCompletedFamily.ok, true);
if (pendingWithoutCompletedFamily.ok) {
  assert(
    validateBookingDealLedgerForState(pendingWithoutCompletedFamily.value).includes(
      "court16_family_provisioning_status=child_created",
    ),
  );
}

assert.equal(
  new Set(HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES).size,
  HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES.length,
  "Deal property names must be unique",
);
assert.equal(HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES.length, 39);
assert.deepEqual(
  new Set(HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS.map((definition) => definition.name)),
  new Set(HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES),
  "Every Deal ledger property must have exactly one schema definition",
);
assert.deepEqual(
  HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS.find(
    (definition) => definition.name === "court16_test_record",
  ),
  {
    name: "court16_test_record",
    label: "Court 16 test record",
    type: "enumeration",
    fieldType: "select",
    description:
      "True only when this Deal came from an internal smoke test, never from a real family.",
    options: [
      { label: "true", value: "true", displayOrder: 0, hidden: false },
      { label: "false", value: "false", displayOrder: 1, hidden: false },
    ],
  },
);
assert.equal(
  HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS.find(
    (definition) => definition.name === "court16_correlation_id",
  )?.hasUniqueValue,
  undefined,
);
assert.equal(
  HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS.find(
    (definition) => definition.name === "court16_booking_key",
  )?.hasUniqueValue,
  true,
);
assert.equal(
  HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS.find(
    (definition) => definition.name === "court16_active_parent_key",
  )?.hasUniqueValue,
  true,
);

const requestedProperties = {
  ...properties,
  pipeline: "pipeline-ridgehill",
  dealstage: "requested",
  class_date: "1784385000000",
  court16_correlation_id: "c16-ledger-test",
} as Record<string, string>;
const existingDeal = {
  id: "deal-1",
  properties: {
    ...requestedProperties,
    dealstage: "scheduled",
    class_date: new Date(Number(requestedProperties.class_date)).toISOString(),
    court16_child_birth_date: "2018-04-02",
  },
  associatedContactIds: ["contact-1"],
};
assert.doesNotThrow(() =>
  assertExistingTrialDealMatches(
    existingDeal,
    {
      contactId: "contact-1",
      correlationId: "c16-ledger-test",
      pipelineId: "pipeline-ridgehill",
    },
    requestedProperties,
  ),
);
assert.equal(existingDeal.properties.dealstage, "scheduled", "idempotency must not regress stage");
assert.throws(
  () =>
    assertExistingTrialDealMatches(
      { ...existingDeal, properties: { ...existingDeal.properties, court16_class_id: "999" } },
      {
        contactId: "contact-1",
        correlationId: "c16-ledger-test",
        pipelineId: "pipeline-ridgehill",
      },
      requestedProperties,
    ),
  HubspotDealConflictError,
);

const hubspotModuleUrl = new URL("../lib/hubspot.ts", import.meta.url).href;
const {
  createTrialDeal,
  findOtherActiveBookingDealsByParentEmail,
  HubspotActiveBookingConflictError,
  getDealByBookingKey,
} = (await import(hubspotModuleUrl)) as typeof import("../lib/hubspot");

const hubspotConfig = {
  accessToken: "offline-test-token",
  portalId: "offline-test-portal",
  trialFormGuid: "",
  apiBaseUrl: "https://hubspot.test",
  formsBaseUrl: "https://forms.test",
  submitLegacyTrialForm: false,
};
const testLogger = {
  correlationId: "hubspot-ledger-offline-test",
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const originalFetch = globalThis.fetch;

const winnerResponse = {
  id: "deal-winner",
  properties: {
    ...requestedProperties,
    dealname: "Alex Example - parent@example.com",
    amount: "0",
    dealstage: "scheduled",
  },
  associations: { contacts: { results: [{ id: "contact-1" }] } },
};

try {
  let directLookupUrl = "";
  globalThis.fetch = async (input) => {
    directLookupUrl = String(input);
    return new Response(JSON.stringify(winnerResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const directDeal = await getDealByBookingKey(
    hubspotConfig,
    testLogger,
    "c16-ledger/test key",
  );
  assert.equal(directDeal?.id, "deal-winner");
  assert.match(directLookupUrl, /c16-ledger%2Ftest%20key\?/);
  assert.match(directLookupUrl, /idProperty=court16_booking_key/);
  assert.match(directLookupUrl, /associations=contacts/);
  assert.match(directLookupUrl, /court16_family_provisioning_status/);

  const conflictCalls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    conflictCalls.push({ url, method });
    if (
      conflictCalls.length === 1 ||
      conflictCalls.length === 2 ||
      conflictCalls.length === 4 ||
      conflictCalls.length === 5
    ) {
      return new Response(JSON.stringify({ status: "error", message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (conflictCalls.length === 3) {
      return new Response(JSON.stringify({ status: "error", message: "duplicate unique value" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(winnerResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const recovered = await createTrialDeal(hubspotConfig, testLogger, {
    contactId: "contact-1",
    correlationId: "c16-ledger-test",
    pipelineId: "pipeline-ridgehill",
    stageId: "requested",
    dealName: "Alex Example - parent@example.com",
    amount: 0,
    classStartsAt: new Date(Number(requestedProperties.class_date)).toISOString(),
    dealProperties: properties,
  });
  assert.equal(recovered.cached, true);
  assert.equal(recovered.id, "deal-winner");
  assert.equal(recovered.existing?.properties.dealstage, "scheduled");
  assert.deepEqual(
    conflictCalls.map(({ method }) => method),
    ["GET", "GET", "POST", "GET", "GET", "GET"],
    "direct-read retries must occur only after the create conflict",
  );
  assert(conflictCalls[0].url.includes("idProperty=court16_booking_key"));
  assert(conflictCalls[1].url.includes("idProperty=court16_active_parent_key"));
  assert(conflictCalls[3].url.includes("idProperty=court16_booking_key"));
  assert(conflictCalls[4].url.includes("idProperty=court16_active_parent_key"));

  const activeConflictCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    activeConflictCalls.push(url);
    if (activeConflictCalls.length <= 2) {
      return new Response(JSON.stringify({ status: "error", message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ status: "error", message: "duplicate unique value" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("idProperty=court16_booking_key")) {
      return new Response(JSON.stringify({ status: "error", message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        ...winnerResponse,
        id: "deal-other-active",
        properties: {
          ...winnerResponse.properties,
          court16_booking_key: "different-booking-key",
          court16_correlation_id: "different-booking-key",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  await assert.rejects(
    createTrialDeal(hubspotConfig, testLogger, {
      contactId: "contact-1",
      correlationId: "c16-ledger-test",
      pipelineId: "pipeline-ridgehill",
      stageId: "requested",
      dealName: "Alex Example - parent@example.com",
      amount: 0,
      classStartsAt: new Date(Number(requestedProperties.class_date)).toISOString(),
      dealProperties: properties,
    }),
    (error: unknown) =>
      error instanceof HubspotActiveBookingConflictError &&
      error.existingDeal.id === "deal-other-active",
  );
  assert(activeConflictCalls.at(-1)?.includes("idProperty=court16_active_parent_key"));

  let activeSearchBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    activeSearchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        total: 2,
        results: [
          {
            id: "deal-current",
            properties: {
              court16_booking_ledger_version: "1",
              court16_booking_key: "current-key",
              court16_booking_status: "intake_started",
              court16_parent_email: "parent@example.com",
            },
          },
          {
            id: "deal-other",
            properties: {
              court16_booking_ledger_version: "1",
              court16_booking_key: "other-key",
              court16_booking_status: "pending_staff",
              court16_parent_email: "parent@example.com",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const otherActiveDeals = await findOtherActiveBookingDealsByParentEmail(
    hubspotConfig,
    testLogger,
    " Parent@Example.com ",
    "deal-current",
  );
  assert.deepEqual(otherActiveDeals.map((deal) => deal.id), ["deal-other"]);
  const serializedActiveSearch = JSON.stringify(activeSearchBody);
  assert(serializedActiveSearch.includes('"court16_parent_email","operator":"EQ","value":"parent@example.com"'));
  assert(serializedActiveSearch.includes('"court16_booking_status","operator":"IN"'));

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        total: 2,
        results: [
          {
            id: "deal-current",
            properties: {
              court16_booking_ledger_version: "1",
              court16_booking_key: "current-key",
              court16_booking_status: "intake_started",
              court16_parent_email: "parent@example.com",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    findOtherActiveBookingDealsByParentEmail(
      hubspotConfig,
      testLogger,
      "parent@example.com",
      "deal-current",
    ),
    /paginated or truncated/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

// ─── Deal-history Mindbody-ID recovery (duplicate guard for terminal Deals) ──
const { findRecordedMindbodyIdsFromDealHistory } = (await import(
  hubspotModuleUrl
)) as typeof import("../lib/hubspot");

try {
  // Happy path: a denied Deal with recorded IDs plus a manual_review Deal
  // without IDs. Both count as history; only present IDs are returned.
  let historySearchBody: unknown;
  globalThis.fetch = async (_input, init) => {
    historySearchBody = JSON.parse(String(init?.body ?? "null"));
    return new Response(
      JSON.stringify({
        total: 2,
        results: [
          {
            id: "deal-denied",
            properties: {
              court16_booking_ledger_version: "1",
              court16_booking_key: "denied-key",
              court16_booking_status: "denied",
              court16_parent_email: "parent@example.com",
              court16_location_slug: "ridgehill",
              court16_mindbody_site_id: "5748154",
              court16_mindbody_parent_id: "1001",
              court16_mindbody_child_id: "1002",
            },
          },
          {
            id: "deal-review",
            properties: {
              court16_booking_ledger_version: "1",
              court16_booking_key: "review-key",
              court16_booking_status: "manual_review",
              court16_parent_email: "parent@example.com",
              court16_location_slug: "ridgehill",
              court16_mindbody_site_id: "5748154",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const history = await findRecordedMindbodyIdsFromDealHistory(
    hubspotConfig,
    testLogger,
    " Parent@Example.com ",
    "ridgehill",
    "5748154",
  );
  assert.deepEqual([...history.ids].sort(), ["1001", "1002"]);
  assert.equal(history.dealCount, 2);
  const serializedHistorySearch = JSON.stringify(historySearchBody);
  assert(serializedHistorySearch.includes('"court16_parent_email","operator":"EQ","value":"parent@example.com"'));
  assert(serializedHistorySearch.includes('"court16_location_slug","operator":"EQ","value":"ridgehill"'));
  assert(serializedHistorySearch.includes('"court16_mindbody_site_id","operator":"EQ","value":"5748154"'));
  assert(!serializedHistorySearch.includes("court16_booking_status\",\"operator\":\"IN\""));

  // Truncated results are not safe evidence that no earlier family exists.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        total: 2,
        results: [
          {
            id: "deal-denied",
            properties: {
              court16_booking_ledger_version: "1",
              court16_parent_email: "parent@example.com",
              court16_location_slug: "ridgehill",
              court16_mindbody_site_id: "5748154",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    findRecordedMindbodyIdsFromDealHistory(
      hubspotConfig,
      testLogger,
      "parent@example.com",
      "ridgehill",
      "5748154",
    ),
    /paginated or truncated/,
  );

  // A row outside the requested club scope means the server-side filter
  // cannot be trusted; site-scoped IDs must never leak across clubs.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        total: 1,
        results: [
          {
            id: "deal-cross-site",
            properties: {
              court16_booking_ledger_version: "1",
              court16_parent_email: "parent@example.com",
              court16_location_slug: "brooklyn",
              court16_mindbody_site_id: "135479",
              court16_mindbody_parent_id: "9001",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    findRecordedMindbodyIdsFromDealHistory(
      hubspotConfig,
      testLogger,
      "parent@example.com",
      "ridgehill",
      "5748154",
    ),
    /requested club scope/,
  );

  await assert.rejects(
    findRecordedMindbodyIdsFromDealHistory(hubspotConfig, testLogger, "  ", "ridgehill", "5748154"),
    /parent email is empty/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("HubSpot Deal booking-ledger contract passed.");
