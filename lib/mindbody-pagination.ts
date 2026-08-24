export interface MindbodyPaginationMetadata {
  RequestedLimit?: number;
  RequestedOffset?: number;
  PageSize?: number;
  TotalResults?: number;
}

export type PaginationDecision =
  | { complete: true }
  | { complete: false; nextOffset: number };

function optionalNonNegativeInteger(
  value: number | undefined,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Mindbody pagination returned invalid ${field}`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Mindbody pagination received invalid ${field}`);
  }
  return value;
}

/** Resolve and validate one Mindbody pagination page before another read. */
export function resolveMindbodyPaginationPage(input: {
  currentOffset: number;
  requestedLimit: number;
  pageLength: number;
  pagination?: MindbodyPaginationMetadata;
}): PaginationDecision {
  const currentOffset = optionalNonNegativeInteger(input.currentOffset, "currentOffset")!;
  const requestLimit = positiveInteger(input.requestedLimit, "requestedLimit");
  const pageLength = optionalNonNegativeInteger(input.pageLength, "pageLength")!;
  const requestedLimit = optionalNonNegativeInteger(
    input.pagination?.RequestedLimit,
    "RequestedLimit",
  );
  const requestedOffset =
    optionalNonNegativeInteger(input.pagination?.RequestedOffset, "RequestedOffset") ??
    currentOffset;
  const pageSize =
    optionalNonNegativeInteger(input.pagination?.PageSize, "PageSize") ?? pageLength;
  const totalResults = optionalNonNegativeInteger(
    input.pagination?.TotalResults,
    "TotalResults",
  );

  if (requestedLimit === 0) {
    throw new Error("Mindbody pagination returned invalid RequestedLimit");
  }
  if (requestedLimit !== undefined && requestedLimit > requestLimit) {
    throw new Error("Mindbody pagination exceeded the requested page limit");
  }
  if (requestedOffset !== currentOffset) {
    throw new Error("Mindbody pagination returned an unexpected RequestedOffset");
  }
  if (pageSize !== pageLength) {
    throw new Error("Mindbody pagination PageSize did not match the returned rows");
  }
  if (pageSize > requestLimit) {
    throw new Error("Mindbody pagination exceeded the requested page limit");
  }

  if (pageLength === 0) {
    if (totalResults === undefined || requestedOffset >= totalResults) return { complete: true };
    throw new Error("Mindbody pagination stopped before TotalResults was reached");
  }

  const nextOffset = requestedOffset + pageSize;
  if (nextOffset <= currentOffset) {
    throw new Error("Mindbody pagination did not advance");
  }
  if (totalResults !== undefined && nextOffset > totalResults) {
    throw new Error("Mindbody pagination returned more rows than TotalResults");
  }
  if (totalResults !== undefined && nextOffset >= totalResults) return { complete: true };
  const effectiveLimit = requestedLimit ?? requestLimit;
  if (totalResults === undefined && pageLength < effectiveLimit) {
    return { complete: true };
  }
  return { complete: false, nextOffset };
}
