/**
 * Read-only Mindbody configuration audit for every Court 16 location.
 *
 * Safety boundary:
 * - POST is used only for /usertoken/issue (authentication).
 * - Every data probe is a GET from the explicit allowlist below.
 * - Client-list endpoints are intentionally absent.
 * - Credentials, bearer tokens, response bodies, and client data are never logged.
 */

type LocationConfig = {
  id: string;
  name: string;
  siteId: number;
  trialBookingEnabled: boolean;
  kidTrialProgramId?: number;
};

type LocationTrialConfig = {
  trialServiceId?: number;
  trialServiceName?: string;
  mindbodyGenderOptions?: readonly string[];
  parentGuardianRelationship?: {
    Id: number;
    RelationshipName1: string;
    RelationshipName2: string;
  };
};

type NamedRecord = {
  Id?: string | number;
  Name?: string;
};

type MindbodyClass = {
  ClassDescription?: {
    Program?: NamedRecord;
  };
};

type ProbeStatus = {
  status: "ok" | "failed";
  count?: number;
  reason?: string;
};

type NamedCandidate = {
  id: string | number;
  name: string;
};

type RelationshipCandidate = {
  id: string | number;
  relationshipName1: string;
  relationshipName2: string;
};

type JsonObject = Record<string, unknown>;

const READ_ENDPOINTS = {
  requiredClientFields: "/client/requiredclientfields",
  relationships: "/site/relationships",
  genders: "/site/genders",
  programs: "/site/programs",
  classes: "/class/classes",
  services: "/sale/services",
} as const;

const BASE_URL = process.env.MINDBODY_BASE_URL ?? "https://api.mindbodyonline.com/public/v6";
const SOURCE_NAME = process.env.MINDBODY_SOURCE_NAME ?? "CedarWindSolutionsLLC";
const REQUEST_TIMEOUT_MS = 20_000;
const AUDIT_SCOPE = {
  kind: "read_only_preflight",
  launchApproval: false,
  verifies: [
    "source_token",
    "required_client_fields_read",
    "relationship_catalog_read",
    "gender_catalog_read",
    "configured_gender_option_presence",
    "program_id_presence",
    "service_id_and_name_presence",
    "upcoming_program_class_presence",
  ],
  doesNotVerify: [
    "service_price_program_or_location_applicability",
    "comp_checkout",
    "required_field_intake_policy",
    "native_email_settings",
    "hubspot_routing_or_workflows",
    "parent_child_end_to_end_writes",
  ],
} as const;

class SafeHttpError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "SafeHttpError";
    this.reason = reason;
  }
}

function safeReason(error: unknown): string {
  return error instanceof SafeHttpError ? error.reason : "network_error";
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SafeHttpError("invalid_response_shape");
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new SafeHttpError("invalid_response_shape");
  }
  return value;
}

function normalizeNamedRecords(value: unknown): NamedRecord[] {
  return asArray(value).flatMap((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const item = record as NamedRecord;
    if ((typeof item.Id !== "number" && typeof item.Id !== "string") || typeof item.Name !== "string") {
      return [];
    }
    return [item];
  });
}

function toCandidate(record: NamedRecord): NamedCandidate {
  return { id: record.Id!, name: record.Name! };
}

function isKidsTrialName(name: string): boolean {
  const childTerm = /\b(kid(?:'s|s)?|child(?:ren)?|youth|junior|teen(?:ager)?|freshman|sophomore)\b/i;
  const trialTerm = /\b(trial|intro(?:duction|ductory)?)\b/i;
  return childTerm.test(name) && trialTerm.test(name);
}

function requiredFieldNames(values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const name = record.Name ?? record.FieldName;
    return typeof name === "string" ? [name] : [];
  });
}

function familyRelationshipCandidates(values: unknown[]): RelationshipCandidate[] {
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const id = record.Id;
    const relationshipName1 = record.RelationshipName1;
    const relationshipName2 = record.RelationshipName2;
    if (
      (typeof id !== "string" && typeof id !== "number") ||
      typeof relationshipName1 !== "string" ||
      typeof relationshipName2 !== "string"
    ) {
      return [];
    }
    if (!/parent|guardian|child|pays\s+for|paid\s+for/i.test(`${relationshipName1} ${relationshipName2}`)) {
      return [];
    }
    return [{ id, relationshipName1, relationshipName2 }];
  });
}

function commonHeaders(apiKey: string, siteId: number, token?: string): HeadersInit {
  return {
    Accept: "application/json",
    "Api-Key": apiKey,
    SiteId: String(siteId),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseJsonResponse(response: Response): Promise<JsonObject> {
  if (!response.ok) {
    throw new SafeHttpError(`http_${response.status}`);
  }
  try {
    return asObject(await response.json());
  } catch (error) {
    if (error instanceof SafeHttpError) throw error;
    throw new SafeHttpError("invalid_json");
  }
}

async function issueSourceToken(
  apiKey: string,
  sourcePassword: string | undefined,
  siteId: number,
): Promise<{ status: "ok"; token: string } | { status: "failed"; reason: string }> {
  if (!sourcePassword) {
    return { status: "failed", reason: "missing_source_password" };
  }

  try {
    const response = await fetch(`${BASE_URL}/usertoken/issue`, {
      method: "POST",
      headers: {
        ...commonHeaders(apiKey, siteId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Username: `_${SOURCE_NAME}`,
        Password: sourcePassword,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await parseJsonResponse(response);
    if (typeof body.AccessToken !== "string" || body.AccessToken.length === 0) {
      return { status: "failed", reason: "missing_access_token" };
    }
    return { status: "ok", token: body.AccessToken };
  } catch (error) {
    return { status: "failed", reason: safeReason(error) };
  }
}

async function getReadEndpoint(
  apiKey: string,
  siteId: number,
  path: (typeof READ_ENDPOINTS)[keyof typeof READ_ENDPOINTS],
  query: Record<string, string | number> = {},
  token?: string,
): Promise<JsonObject> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: "GET",
    headers: commonHeaders(apiKey, siteId, token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseJsonResponse(response);
}

async function runProbe<T>(work: () => Promise<T>): Promise<{ status: ProbeStatus; value?: T }> {
  try {
    return { status: { status: "ok" }, value: await work() };
  } catch (error) {
    return { status: { status: "failed", reason: safeReason(error) } };
  }
}

function withCount(status: ProbeStatus, value: unknown[] | undefined): ProbeStatus {
  return status.status === "ok" ? { ...status, count: value?.length ?? 0 } : status;
}

async function auditLocation(
  location: LocationConfig,
  trialConfig: LocationTrialConfig | undefined,
  apiKey: string,
  sourcePassword: string | undefined,
) {
  const tokenResult = await issueSourceToken(apiKey, sourcePassword, location.siteId);
  const token = tokenResult.status === "ok" ? tokenResult.token : undefined;

  // These endpoints are useful even before source authorization is complete.
  // When no source token is available they run in consumer mode and the token
  // probe remains failed, making hidden-class visibility explicit.
  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 30);
  const startDate = `${today.toISOString().slice(0, 10)}T00:00:00`;
  const endDate = `${end.toISOString().slice(0, 10)}T23:59:59`;

  const [
    gendersResult,
    requiredFieldsResult,
    relationshipsResult,
    programsResult,
    classesResult,
    servicesResult,
  ] =
    await Promise.all([
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.genders,
          {},
          token,
        );
        const activeOptions = asArray(body.GenderOptions).filter((option) => {
          if (!option || typeof option !== "object" || Array.isArray(option)) return false;
          return (option as Record<string, unknown>).IsActive !== false;
        });
        return normalizeNamedRecords(activeOptions);
      }),
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.requiredClientFields,
          {},
          token,
        );
        return asArray(body.RequiredClientFields);
      }),
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.relationships,
          { Limit: 200 },
          token,
        );
        return asArray(body.Relationships);
      }),
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.programs,
          { Limit: 200 },
          token,
        );
        return normalizeNamedRecords(body.Programs);
      }),
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.classes,
          {
            StartDateTime: startDate,
            EndDateTime: endDate,
            ...(location.kidTrialProgramId != null
              ? { ProgramIds: String(location.kidTrialProgramId) }
              : {}),
            Limit: 200,
          },
          token,
        );
        return asArray(body.Classes) as MindbodyClass[];
      }),
      runProbe(async () => {
        const body = await getReadEndpoint(
          apiKey,
          location.siteId,
          READ_ENDPOINTS.services,
          { Limit: 200 },
          token,
        );
        return normalizeNamedRecords(body.Services);
      }),
    ]);

  const configuredProgramId = location.kidTrialProgramId;
  const configuredServiceId = trialConfig?.trialServiceId;
  const configuredServiceName = trialConfig?.trialServiceName;
  const configuredRelationship = trialConfig?.parentGuardianRelationship;
  const configuredGenderOptions = trialConfig?.mindbodyGenderOptions ?? [];
  const programs = programsResult.value ?? [];
  const services = servicesResult.value ?? [];
  const classes = classesResult.value ?? [];
  const requiredFields = requiredFieldNames(requiredFieldsResult.value ?? []);
  const familyRelationships = familyRelationshipCandidates(relationshipsResult.value ?? []);
  const availableGenders = gendersResult.value ?? [];
  const programCandidates = programs
    .filter(
      (program) =>
        String(program.Id) === String(configuredProgramId ?? "") || isKidsTrialName(program.Name ?? ""),
    )
    .map(toCandidate);
  const serviceCandidates = services
    .filter(
      (service) =>
        String(service.Id) === String(configuredServiceId ?? "") || isKidsTrialName(service.Name ?? ""),
    )
    .map(toCandidate);
  const candidateProgramIds = new Set(programCandidates.map((program) => String(program.id)));
  const trialClassCount =
    configuredProgramId != null
      ? classes.length
      : classes.filter((item) => {
          const program = item.ClassDescription?.Program;
          return program?.Id != null && candidateProgramIds.has(String(program.Id));
        }).length;

  const configuredProgramFound =
    configuredProgramId != null && programs.some((program) => String(program.Id) === String(configuredProgramId));
  const configuredServiceFound =
    configuredServiceId != null &&
    configuredServiceName != null &&
    services.some(
      (service) =>
        String(service.Id) === String(configuredServiceId) && service.Name === configuredServiceName,
    );
  const configuredRelationshipFound =
    configuredRelationship != null &&
    familyRelationships.some(
      (relationship) =>
        String(relationship.id) === String(configuredRelationship.Id) &&
        relationship.relationshipName1 === configuredRelationship.RelationshipName1 &&
        relationship.relationshipName2 === configuredRelationship.RelationshipName2,
    );
  const availableGenderNames = new Set(availableGenders.map((gender) => gender.Name));
  const configuredGendersFound =
    configuredGenderOptions.length > 0 &&
    configuredGenderOptions.every((gender) => availableGenderNames.has(gender));
  const probeStatuses = [
    requiredFieldsResult.status,
    relationshipsResult.status,
    gendersResult.status,
    programsResult.status,
    classesResult.status,
    servicesResult.status,
  ];
  const trialEnabledFailure =
    location.trialBookingEnabled &&
    (tokenResult.status !== "ok" ||
      probeStatuses.some((probe) => probe.status !== "ok") ||
      !configuredProgramFound ||
      !configuredServiceFound ||
      !configuredRelationshipFound ||
      !configuredGendersFound ||
      trialClassCount === 0);

  return {
    location: location.id,
    name: location.name,
    siteId: location.siteId,
    trialEnabled: location.trialBookingEnabled,
    overall: location.trialBookingEnabled ? (trialEnabledFailure ? "fail" : "pass") : "blocked",
    sourceToken:
      tokenResult.status === "ok"
        ? { status: "ok" as const }
        : { status: "failed" as const, reason: tokenResult.reason },
    probes: {
      requiredClientFields: withCount(requiredFieldsResult.status, requiredFieldsResult.value),
      relationships: withCount(relationshipsResult.status, relationshipsResult.value),
      genders: withCount(gendersResult.status, gendersResult.value),
      programs: withCount(programsResult.status, programsResult.value),
      classes: {
        ...withCount(classesResult.status, classesResult.value),
        ...(classesResult.status.status === "ok" ? { candidateKidsTrialCount: trialClassCount } : {}),
      },
      services: withCount(servicesResult.status, servicesResult.value),
    },
    configuredKidsTrial: {
      programId: configuredProgramId ?? null,
      programFound: configuredProgramFound,
      serviceId: configuredServiceId ?? null,
      serviceName: configuredServiceName ?? null,
      serviceFound: configuredServiceFound,
      parentGuardianRelationship: configuredRelationship ?? null,
      parentGuardianRelationshipFound: configuredRelationshipFound,
      genderOptions: configuredGenderOptions,
      genderOptionsFound: configuredGendersFound,
    },
    candidateKidsTrialPrograms: programCandidates,
    candidateKidsTrialServices: serviceCandidates,
    requiredClientFields: requiredFields,
    availableGenders: availableGenders.map(toCandidate),
    candidateFamilyRelationships: familyRelationships,
  };
}

async function main(): Promise<void> {
  // Computed URLs let native Node TypeScript load the config without requiring
  // a project-wide allowImportingTsExtensions compiler change.
  const locationsUrl = new URL("../config/locations.ts", import.meta.url).href;
  const trialConfigUrl = new URL("../config/trial-config.ts", import.meta.url).href;
  const [{ LOCATIONS }, { TRIAL_CONFIG }] = (await Promise.all([
    import(locationsUrl),
    import(trialConfigUrl),
  ])) as [
    { LOCATIONS: LocationConfig[] },
    { TRIAL_CONFIG: Record<string, LocationTrialConfig> },
  ];

  const apiKey = process.env.MINDBODY_API_KEY;
  if (!apiKey) {
    const locations = LOCATIONS.map((location) => ({
      location: location.id,
      siteId: location.siteId,
      trialEnabled: location.trialBookingEnabled,
      overall: location.trialBookingEnabled ? "fail" : "blocked",
      sourceToken: { status: "failed", reason: "missing_api_key" },
      probes: { status: "blocked", reason: "missing_api_key" },
    }));
    console.log(
      JSON.stringify(
        {
          scope: AUDIT_SCOPE,
          summary: { pass: 0, fail: 1, blocked: locations.length - 1 },
          locations,
        },
        null,
        2,
      ),
    );
    process.exitCode = LOCATIONS.some((location) => location.trialBookingEnabled) ? 1 : 0;
    return;
  }

  const locations = [];
  for (const location of LOCATIONS) {
    locations.push(
      await auditLocation(
        location,
        TRIAL_CONFIG[location.id],
        apiKey,
        process.env.MINDBODY_SOURCE_PASSWORD,
      ),
    );
  }

  const summary = {
    pass: locations.filter((location) => location.overall === "pass").length,
    fail: locations.filter((location) => location.overall === "fail").length,
    blocked: locations.filter((location) => location.overall === "blocked").length,
  };
  console.log(
    JSON.stringify(
      { auditedAt: new Date().toISOString(), scope: AUDIT_SCOPE, summary, locations },
      null,
      2,
    ),
  );
  process.exitCode = summary.fail > 0 ? 1 : 0;
}

main().catch(() => {
  console.error(JSON.stringify({ status: "failed", reason: "audit_initialization_failed" }));
  process.exitCode = 2;
});
