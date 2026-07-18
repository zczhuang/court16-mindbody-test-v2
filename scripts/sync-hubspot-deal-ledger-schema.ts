/**
 * Safe HubSpot Deal-ledger schema planner, verifier, and additive migration.
 *
 * Safety boundary:
 * - No arguments: offline plan only; no network request is made.
 * - --verify: GET-only inspection; requires HUBSPOT_ACCESS_TOKEN.
 * - --apply: requires HUBSPOT_DEAL_SCHEMA_APPLY=true and a token.
 * - Apply creates only a missing property group and missing properties.
 * - Existing definitions are never changed, archived, or deleted.
 * - Every existing definition is checked before the first write.
 */

type JsonObject = Record<string, unknown>;
type Mode = "plan" | "verify" | "apply";

type PropertyDefinition = {
  name: string;
  label: string;
  type: "string" | "enumeration" | "date" | "datetime";
  fieldType: "text" | "textarea" | "select" | "date";
  description: string;
  options?: Array<{
    label: string;
    value: string;
    displayOrder: number;
    hidden: false;
  }>;
  hasUniqueValue?: boolean;
};

type ExistingGroup = {
  name: string;
  archived?: boolean;
};

type ExistingProperty = {
  name: string;
  groupName: string;
  type: string;
  fieldType: string;
  options: Array<{ value: string; hidden?: boolean }>;
  hasUniqueValue?: boolean;
  archived?: boolean;
  calculated?: boolean;
  externalOptions?: boolean;
  hidden?: boolean;
  hubspotDefined?: boolean;
};

type SchemaInspection = {
  groupExists: boolean;
  missing: PropertyDefinition[];
  incompatible: string[];
};

type CustomPropertyLimits = {
  overallLimit: number;
  overallUsage: number;
  dealLimit: number;
  dealUsage: number;
};

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const OBJECT_TYPE = "deals";
const GROUP_LABEL = "Court 16 booking";
const REQUEST_TIMEOUT_MS = 30_000;
const DEAL_OBJECT_TYPE_ID = "0-3";
const MAX_UNIQUE_PROPERTIES_PER_OBJECT = 10;

function parseMode(args: string[]): Mode {
  if (args.length === 0) return "plan";
  if (args.length === 1 && args[0] === "--verify") return "verify";
  if (args.length === 1 && args[0] === "--apply") return "apply";
  throw new Error("Usage: sync-hubspot-deal-ledger-schema.ts [--verify | --apply]");
}

function requireAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("HUBSPOT_ACCESS_TOKEN is required for --verify and --apply.");
  }
  return token;
}

function requireApplyApproval(): void {
  if (process.env.HUBSPOT_DEAL_SCHEMA_APPLY !== "true") {
    throw new Error("--apply requires HUBSPOT_DEAL_SCHEMA_APPLY=true.");
  }
}

function asObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`HubSpot returned an invalid ${context} response.`);
  }
  return value as JsonObject;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`HubSpot returned an invalid ${context}.`);
  }
  return value;
}

function asOptionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`HubSpot returned an invalid ${context}.`);
  }
  return value;
}

function asNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`HubSpot returned an invalid ${context}.`);
  }
  return value;
}

function responseResults(value: unknown, context: string): unknown[] {
  const result = asObject(value, context).results;
  if (!Array.isArray(result)) {
    throw new Error(`HubSpot returned an invalid ${context} results list.`);
  }
  return result;
}

function parseGroups(value: unknown): ExistingGroup[] {
  return responseResults(value, "Deal property groups").map((item, index) => {
    const group = asObject(item, `Deal property group ${index}`);
    return {
      name: asString(group.name, `Deal property group ${index} name`),
      archived: asOptionalBoolean(group.archived, `Deal property group ${index} archived flag`),
    };
  });
}

function parseProperties(value: unknown): ExistingProperty[] {
  return responseResults(value, "Deal properties").map((item, index) => {
    const property = asObject(item, `Deal property ${index}`);
    if (!Array.isArray(property.options)) {
      throw new Error(`HubSpot returned invalid options for Deal property ${index}.`);
    }
    const options = property.options.map((option, optionIndex) => {
      const parsed = asObject(option, `Deal property ${index} option ${optionIndex}`);
      return {
        value: asString(parsed.value, `Deal property ${index} option ${optionIndex} value`),
        hidden: asOptionalBoolean(
          parsed.hidden,
          `Deal property ${index} option ${optionIndex} hidden flag`,
        ),
      };
    });

    return {
      name: asString(property.name, `Deal property ${index} name`),
      groupName: asString(property.groupName, `Deal property ${index} group name`),
      type: asString(property.type, `Deal property ${index} type`),
      fieldType: asString(property.fieldType, `Deal property ${index} field type`),
      options,
      hasUniqueValue: asOptionalBoolean(
        property.hasUniqueValue,
        `Deal property ${index} unique-value flag`,
      ),
      archived: asOptionalBoolean(property.archived, `Deal property ${index} archived flag`),
      calculated: asOptionalBoolean(property.calculated, `Deal property ${index} calculated flag`),
      externalOptions: asOptionalBoolean(
        property.externalOptions,
        `Deal property ${index} external-options flag`,
      ),
      hidden: asOptionalBoolean(property.hidden, `Deal property ${index} hidden flag`),
      hubspotDefined: asOptionalBoolean(
        property.hubspotDefined,
        `Deal property ${index} HubSpot-defined flag`,
      ),
    };
  });
}

function parseCustomPropertyLimits(value: unknown): CustomPropertyLimits {
  const body = asObject(value, "custom property limits");
  if (!Array.isArray(body.byObjectType)) {
    throw new Error("HubSpot returned an invalid custom property limit object list.");
  }
  const dealEntry = body.byObjectType
    .map((item, index) => asObject(item, `custom property limit object ${index}`))
    .find((item) => item.objectTypeId === DEAL_OBJECT_TYPE_ID);
  if (!dealEntry) {
    throw new Error("HubSpot custom property limits did not include the Deal object.");
  }
  return {
    overallLimit: asNonNegativeInteger(body.overallLimit, "overall custom property limit"),
    overallUsage: asNonNegativeInteger(body.overallUsage, "overall custom property usage"),
    dealLimit: asNonNegativeInteger(dealEntry.limit, "Deal custom property limit"),
    dealUsage: asNonNegativeInteger(dealEntry.usage, "Deal custom property usage"),
  };
}

async function hubspotRequest(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: JsonObject,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      `HubSpot ${method} ${path} did not complete; run --verify before retrying any apply.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `HubSpot ${method} ${path} returned HTTP ${response.status}; no automatic recovery was attempted.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`HubSpot ${method} ${path} returned invalid JSON.`);
  }
}

function duplicateNames(values: Array<{ name: string }>, context: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.name)) duplicates.add(value.name);
    seen.add(value.name);
  }
  return [...duplicates].map((name) => `${context} contains duplicate internal name ${name}`);
}

function propertyCompatibilityIssues(
  existing: ExistingProperty,
  expected: PropertyDefinition,
  groupName: string,
): string[] {
  const issues: string[] = [];
  const add = (detail: string) => issues.push(`${expected.name}: ${detail}`);

  if (existing.groupName !== groupName) {
    add(`group is ${existing.groupName}, expected ${groupName}`);
  }
  if (existing.type !== expected.type) {
    add(`type is ${existing.type}, expected ${expected.type}`);
  }
  if (existing.fieldType !== expected.fieldType) {
    add(`fieldType is ${existing.fieldType}, expected ${expected.fieldType}`);
  }
  if (existing.archived === true) add("property is archived");
  if (existing.calculated === true) add("property is calculated");
  if (existing.externalOptions === true) add("property uses external options");
  if (existing.hidden === true) add("property is hidden");
  if (existing.hubspotDefined === true) add("property is HubSpot-defined");

  const expectedUnique = expected.hasUniqueValue === true;
  const existingUnique = existing.hasUniqueValue === true;
  if (expectedUnique && !existingUnique) {
    add("hasUniqueValue is false or unknown, expected true");
  }

  const expectedOptions = (expected.options ?? []).map((option) => option.value).sort();
  const existingOptions = existing.options
    .filter((option) => option.hidden !== true)
    .map((option) => option.value)
    .sort();
  if (JSON.stringify(existingOptions) !== JSON.stringify(expectedOptions)) {
    add(
      `active option values are [${existingOptions.join(", ")}], expected [${expectedOptions.join(", ")}]`,
    );
  }

  return issues;
}

function inspectSchema(
  groups: ExistingGroup[],
  properties: ExistingProperty[],
  definitions: readonly PropertyDefinition[],
  groupName: string,
): SchemaInspection {
  const incompatible = [
    ...duplicateNames(groups, "Deal property groups"),
    ...duplicateNames(properties, "Deal properties"),
  ];
  const matchingGroups = groups.filter((group) => group.name === groupName);
  if (matchingGroups.some((group) => group.archived === true)) {
    incompatible.push(`${groupName}: property group is archived`);
  }

  const byName = new Map(properties.map((property) => [property.name, property]));
  const missing: PropertyDefinition[] = [];
  for (const definition of definitions) {
    const existing = byName.get(definition.name);
    if (!existing) {
      missing.push(definition);
      continue;
    }
    incompatible.push(...propertyCompatibilityIssues(existing, definition, groupName));
  }

  return {
    groupExists: matchingGroups.length === 1 && matchingGroups[0].archived !== true,
    missing,
    incompatible,
  };
}

async function readSchema(token: string): Promise<{
  groups: ExistingGroup[];
  properties: ExistingProperty[];
  limits: CustomPropertyLimits;
}> {
  const [groups, properties, limits] = await Promise.all([
    hubspotRequest(token, "GET", `/crm/v3/properties/${OBJECT_TYPE}/groups`),
    hubspotRequest(token, "GET", `/crm/v3/properties/${OBJECT_TYPE}?archived=false`),
    hubspotRequest(token, "GET", "/crm/v3/limits/custom-properties"),
  ]);
  return {
    groups: parseGroups(groups),
    properties: parseProperties(properties),
    limits: parseCustomPropertyLimits(limits),
  };
}

function capacityIssues(
  properties: ExistingProperty[],
  missing: readonly PropertyDefinition[],
  limits: CustomPropertyLimits,
): string[] {
  const issues: string[] = [];
  if (limits.overallUsage + missing.length > limits.overallLimit) {
    issues.push(
      `custom property capacity is ${limits.overallUsage}/${limits.overallLimit} overall; ${missing.length} missing booking properties would exceed it`,
    );
  }
  if (limits.dealUsage + missing.length > limits.dealLimit) {
    issues.push(
      `Deal custom property capacity is ${limits.dealUsage}/${limits.dealLimit}; ${missing.length} missing booking properties would exceed it`,
    );
  }

  const existingUniqueCount = properties.filter(
    (property) => property.hasUniqueValue === true && property.hubspotDefined !== true,
  ).length;
  const missingUniqueCount = missing.filter(
    (definition) => definition.hasUniqueValue === true,
  ).length;
  if (existingUniqueCount + missingUniqueCount > MAX_UNIQUE_PROPERTIES_PER_OBJECT) {
    issues.push(
      `Deal unique-ID property capacity is ${existingUniqueCount}/${MAX_UNIQUE_PROPERTIES_PER_OBJECT}; ${missingUniqueCount} missing unique booking properties would exceed it`,
    );
  }
  return issues;
}

function printPlan(definitions: readonly PropertyDefinition[], groupName: string): void {
  console.log("Mode: offline plan (no HubSpot requests; no writes)");
  console.log(`Property group: ${groupName} (${GROUP_LABEL})`);
  console.log(`Deal properties: ${definitions.length}`);
  for (const definition of definitions) {
    const suffix = definition.hasUniqueValue === true ? " [unique]" : "";
    console.log(`- ${definition.name}: ${definition.type}/${definition.fieldType}${suffix}`);
  }
  console.log("Use --verify for a GET-only live comparison.");
}

function printInspection(inspection: SchemaInspection): void {
  console.log(`Property group: ${inspection.groupExists ? "present" : "missing"}`);
  console.log(`Missing Deal properties: ${inspection.missing.length}`);
  for (const definition of inspection.missing) console.log(`- ${definition.name}`);
  console.log(`Incompatible Deal definitions: ${inspection.incompatible.length}`);
  for (const issue of inspection.incompatible) console.error(`- ${issue}`);
}

function createPropertyBody(definition: PropertyDefinition, groupName: string): JsonObject {
  return {
    groupName,
    name: definition.name,
    label: definition.label,
    description: definition.description,
    type: definition.type,
    fieldType: definition.fieldType,
    options: definition.options ?? [],
    hasUniqueValue: definition.hasUniqueValue === true,
    hidden: false,
    formField: false,
    displayOrder: -1,
  };
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const moduleUrl = new URL("../lib/hubspot-deal-ledger.ts", import.meta.url).href;
  const ledgerModule = (await import(moduleUrl)) as {
    HUBSPOT_BOOKING_PROPERTY_GROUP: string;
    HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS: readonly PropertyDefinition[];
    HUBSPOT_REQUIRED_EXTERNAL_DEAL_PROPERTIES: readonly string[];
  };
  const groupName = ledgerModule.HUBSPOT_BOOKING_PROPERTY_GROUP;
  const definitions = ledgerModule.HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS;
  const externalNames = ledgerModule.HUBSPOT_REQUIRED_EXTERNAL_DEAL_PROPERTIES ?? [];

  if (mode === "plan") {
    printPlan(definitions, groupName);
    if (externalNames.length > 0) {
      console.log(
        `Requires pre-existing portal Deal properties (verified, never created): ${externalNames.join(", ")}`,
      );
    }
    return;
  }

  if (mode === "apply") requireApplyApproval();
  const token = requireAccessToken();
  const current = await readSchema(token);
  const inspection = inspectSchema(current.groups, current.properties, definitions, groupName);
  inspection.incompatible.push(
    ...capacityIssues(current.properties, inspection.missing, current.limits),
  );
  // The runtime writes these legacy pipeline properties (Deal creation writes
  // class_date; denial writes denial_reason/denial_note). They are owned by
  // the portal, not this ledger, so their absence blocks apply with a clear
  // message instead of surfacing later as a runtime 400 on Deal creation.
  const existingNames = new Set(current.properties.map((property) => property.name));
  for (const name of externalNames) {
    if (!existingNames.has(name)) {
      inspection.incompatible.push(
        `${name}: required pre-existing portal Deal property is missing; create it in HubSpot (it pre-dates this ledger and is intentionally not defined here)`,
      );
    }
  }
  printInspection(inspection);

  if (inspection.incompatible.length > 0) {
    throw new Error("Existing Deal schema is incompatible; no changes were made.");
  }
  if (mode === "verify") {
    if (!inspection.groupExists || inspection.missing.length > 0) process.exitCode = 1;
    else console.log("Deal booking-ledger schema is compatible and complete.");
    return;
  }

  if (!inspection.groupExists) {
    await hubspotRequest(token, "POST", `/crm/v3/properties/${OBJECT_TYPE}/groups`, {
      name: groupName,
      label: GROUP_LABEL,
      displayOrder: -1,
    });
    console.log(`Created Deal property group ${groupName}.`);
  }

  for (const definition of inspection.missing) {
    await hubspotRequest(
      token,
      "POST",
      `/crm/v3/properties/${OBJECT_TYPE}`,
      createPropertyBody(definition, groupName),
    );
    console.log(`Created Deal property ${definition.name}.`);
  }

  if (inspection.groupExists && inspection.missing.length === 0) {
    console.log("Deal booking-ledger schema was already complete; no writes were made.");
    return;
  }

  const finalSchema = await readSchema(token);
  const finalInspection = inspectSchema(
    finalSchema.groups,
    finalSchema.properties,
    definitions,
    groupName,
  );
  if (
    !finalInspection.groupExists ||
    finalInspection.missing.length > 0 ||
    finalInspection.incompatible.length > 0
  ) {
    throw new Error("Post-apply verification failed; do not retry writes until --verify is reviewed.");
  }
  console.log("Deal booking-ledger schema is compatible and complete.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Deal schema sync failed.");
  process.exitCode = 2;
});
