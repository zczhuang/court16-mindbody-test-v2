import assert from "node:assert/strict";
import { resolveMindbodyPaginationPage } from "../lib/mindbody-pagination.ts";

assert.deepEqual(
  resolveMindbodyPaginationPage({
    currentOffset: 0,
    requestedLimit: 200,
    pageLength: 200,
    pagination: {
      RequestedLimit: 200,
      RequestedOffset: 0,
      PageSize: 200,
      TotalResults: 250,
    },
  }),
  { complete: false, nextOffset: 200 },
);
assert.deepEqual(
  resolveMindbodyPaginationPage({
    currentOffset: 200,
    requestedLimit: 200,
    pageLength: 50,
    pagination: {
      RequestedLimit: 200,
      RequestedOffset: 200,
      PageSize: 50,
      TotalResults: 250,
    },
  }),
  { complete: true },
);
assert.deepEqual(
  resolveMindbodyPaginationPage({
    currentOffset: 0,
    requestedLimit: 200,
    pageLength: 100,
    pagination: {
      RequestedLimit: 100,
      RequestedOffset: 0,
      PageSize: 100,
    },
  }),
  { complete: false, nextOffset: 100 },
);
assert.deepEqual(
  resolveMindbodyPaginationPage({
    currentOffset: 0,
    requestedLimit: 200,
    pageLength: 200,
  }),
  { complete: false, nextOffset: 200 },
);
assert.deepEqual(
  resolveMindbodyPaginationPage({
    currentOffset: 200,
    requestedLimit: 200,
    pageLength: 25,
  }),
  { complete: true },
);

assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 200,
      requestedLimit: 200,
      pageLength: 50,
      pagination: { RequestedOffset: 0, PageSize: 50, TotalResults: 250 },
    }),
  /unexpected RequestedOffset/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 1,
      pagination: { RequestedOffset: 0, PageSize: 0, TotalResults: 2 },
    }),
  /PageSize/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 0,
      pagination: { RequestedOffset: 0, PageSize: 0, TotalResults: 2 },
    }),
  /stopped before TotalResults/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 1,
      pagination: { RequestedOffset: -1, PageSize: 1, TotalResults: 2 },
    }),
  /invalid RequestedOffset/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 201,
    }),
  /exceeded the requested page limit/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 2,
      pagination: { RequestedOffset: 0, PageSize: 2, TotalResults: 1 },
    }),
  /more rows than TotalResults/,
);
assert.throws(
  () =>
    resolveMindbodyPaginationPage({
      currentOffset: 0,
      requestedLimit: 200,
      pageLength: 0,
      pagination: { RequestedLimit: 0, RequestedOffset: 0, PageSize: 0 },
    }),
  /invalid RequestedLimit/,
);

console.log("Mindbody pagination validation passed.");
