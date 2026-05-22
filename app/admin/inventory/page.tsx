/**
 * Admin inventory dashboard — read-only "see everything" view across
 * MindBody (Site 5748154 Ridge Hill), HubSpot (Court 16 portal 4832170),
 * and Cedarwind's own runtime state.
 *
 * Auth: ?key=<value> query param matched against INVENTORY_ACCESS_KEY env var.
 * If the env var is unset, the page 404s. If the query param doesn't match,
 * 401. This is intentionally cheap auth — surface this page surfaces real
 * Client data, so the key acts as a one-off shared secret.
 *
 * Rendering: server component. Each section fetches independently via
 * Promise.allSettled so one failed endpoint doesn't break the whole page.
 * No client-side interactivity needed for v1 — section anchors handle
 * jump-to-tab navigation.
 *
 * To extend with new sections: add a new fetch in `gatherInventory()` and
 * a new <Section> in the JSX. Keep the section bodies <200 rows each for
 * readable scans; switch to client-side pagination if any one source
 * blows past that.
 */

import { notFound } from "next/navigation";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { authedMindbodyGet, loadConfigFromEnv } from "@/lib/mindbody";
import { loadHubspotConfig } from "@/lib/hubspot";
import { LOCATIONS, getLocationById } from "@/config/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIALS_PIPELINE_ID = "830977386"; // KIDS TRIALS (RIDGE HILL)
const SITE_RH = "5748154";

// ─── data shapes (loose) ──────────────────────────────────────────────────────
type Bag = { ok: true; data: unknown } | { ok: false; error: string };

// ─── fetchers ────────────────────────────────────────────────────────────────

async function fetchMindbody<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  siteId: string = SITE_RH,
): Promise<Bag> {
  const log = createLogger(makeCorrelationId());
  try {
    const data = await authedMindbodyGet<T>(log, {
      siteIdOverride: siteId,
      path,
      query,
      consumerMode: true,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchHubspot(url: string, init: RequestInit): Promise<Bag> {
  const cfg = loadHubspotConfig();
  if (!cfg?.accessToken) {
    return { ok: false, error: "HUBSPOT_ACCESS_TOKEN not set" };
  }
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── orchestrator ────────────────────────────────────────────────────────────

async function gatherInventory() {
  const today = new Date();
  const startISO = today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + 2);
  const endISO = endDate.toISOString().slice(0, 10);

  const [
    mbPrograms,
    mbClassDescriptions,
    mbClassSchedules,
    mbClasses,
    mbServices,
    mbStaff,
    mbResources,
    mbRelationships,
    mbRequiredFields,
    mbSites,
    hsTrialDeals,
    hsCedarwindContacts,
    hsCourt16Properties,
    hsWorkflows,
    hsTrialEmails,
  ] = await Promise.all([
    fetchMindbody("/site/programs", { Limit: 100 }),
    fetchMindbody("/class/classdescriptions", { Limit: 200 }),
    fetchMindbody("/class/classschedules", { Limit: 200 }),
    fetchMindbody("/class/classes", {
      StartDateTime: `${startISO}T00:00:00`,
      EndDateTime: `${endISO}T23:59:59`,
      Limit: 200,
    }),
    fetchMindbody("/sale/services", { Limit: 200 }),
    fetchMindbody("/staff/staff", { Limit: 100 }),
    fetchMindbody("/site/resources", { Limit: 100 }),
    fetchMindbody("/site/relationships", { Limit: 50 }),
    fetchMindbody("/client/requiredclientfields"),
    fetchMindbody("/site/sites"),
    fetchHubspot("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "pipeline", operator: "EQ", value: TRIALS_PIPELINE_ID }] },
        ],
        properties: [
          "dealname",
          "dealstage",
          "class_date",
          "court16_correlation_id",
          "createdate",
          "amount",
        ],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        limit: 50,
      }),
    }),
    fetchHubspot("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "court16_correlation_id", operator: "HAS_PROPERTY" }] },
        ],
        properties: [
          "firstname",
          "lastname",
          "email",
          "court16_correlation_id",
          "court16_booking_status",
          "court16_class_id",
          "court16_location_slug",
          "court16_mindbody_parent_id",
          "court16_mindbody_child_id",
          "createdate",
        ],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        limit: 50,
      }),
    }),
    fetchHubspot("https://api.hubapi.com/crm/v3/properties/contacts", { method: "GET" }),
    fetchHubspot("https://api.hubapi.com/automation/v4/flows?limit=200", { method: "GET" }),
    fetchHubspot("https://api.hubapi.com/marketing/v3/emails?limit=200", { method: "GET" }),
  ]);

  return {
    mbPrograms,
    mbClassDescriptions,
    mbClassSchedules,
    mbClasses,
    mbServices,
    mbStaff,
    mbResources,
    mbRelationships,
    mbRequiredFields,
    mbSites,
    hsTrialDeals,
    hsCedarwindContacts,
    hsCourt16Properties,
    hsWorkflows,
    hsTrialEmails,
    window: { startISO, endISO },
  };
}

// ─── tiny render helpers (kept inline so this stays one file) ────────────────

function Section({
  id,
  title,
  subtitle,
  bag,
  empty = "No data",
  render,
}: {
  id: string;
  title: string;
  subtitle?: string;
  bag: Bag;
  empty?: string;
  render: (data: unknown) => React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: 36 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
      {subtitle && (
        <p style={{ fontSize: 13, color: "var(--c16-ink-3)", margin: "0 0 12px" }}>{subtitle}</p>
      )}
      <div
        style={{
          background: "var(--c16-paper)",
          border: "1px solid var(--c16-line)",
          borderRadius: 8,
          padding: 14,
          overflowX: "auto",
        }}
      >
        {!bag.ok ? (
          <div
            style={{
              padding: 12,
              background: "var(--c16-red-soft)",
              color: "var(--c16-red)",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "var(--f-mono)",
            }}
          >
            <strong>Fetch failed:</strong> {bag.error}
          </div>
        ) : isEmpty(bag.data) ? (
          <div style={{ padding: 12, color: "var(--c16-ink-3)", fontSize: 13 }}>{empty}</div>
        ) : (
          render(bag.data)
        )}
      </div>
    </section>
  );
}

function isEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    // MindBody pagination shape
    if (o.PaginationResponse && typeof o.PaginationResponse === "object") {
      const p = o.PaginationResponse as { TotalResults?: number };
      if (typeof p.TotalResults === "number") return p.TotalResults === 0;
    }
    // HubSpot search response
    if (Array.isArray(o.results)) return o.results.length === 0;
  }
  return false;
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
        fontFamily: "var(--f-sans)",
      }}
    >
      <thead>
        <tr style={{ background: "var(--c16-paper-2)" }}>
          {headers.map((h) => (
            <th
              key={h}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--c16-ink-3)",
                borderBottom: "1px solid var(--c16-line)",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx} style={{ borderBottom: "1px solid var(--c16-line-2)" }}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  padding: "8px 10px",
                  fontFamily: ci === 0 ? "var(--f-mono)" : "var(--f-sans)",
                  fontSize: ci === 0 ? 12 : 13,
                  color: "var(--c16-ink)",
                  verticalAlign: "top",
                  whiteSpace: "nowrap",
                }}
              >
                {cell ?? <span style={{ color: "var(--c16-ink-4)" }}>—</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const expected = process.env.INVENTORY_ACCESS_KEY;
  if (!expected) {
    // Treat as undeployed when the env var isn't set; do not leak the path's existence.
    notFound();
  }
  const params = await searchParams;
  if (!params.key || params.key !== expected) {
    return (
      <main style={{ padding: 80, fontFamily: "var(--f-sans)", color: "var(--c16-ink-2)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Court 16 · Admin inventory</h1>
        <p style={{ fontSize: 14, marginTop: 16 }}>
          Append <code>?key=&lt;INVENTORY_ACCESS_KEY&gt;</code> to access. The key is set as an
          environment variable on Vercel (<code>INVENTORY_ACCESS_KEY</code>) and held in
          LastPass.
        </p>
      </main>
    );
  }

  const inv = await gatherInventory();
  const mbConfig = (() => {
    try {
      return loadConfigFromEnv();
    } catch {
      return null;
    }
  })();
  const hsConfig = loadHubspotConfig();

  return (
    <main
      style={{
        padding: "32px 24px 80px",
        fontFamily: "var(--f-sans)",
        color: "var(--c16-ink)",
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--c16-ink-3)",
            marginBottom: 6,
            fontFamily: "var(--f-mono)",
          }}
        >
          Cedarwind · Court 16 inventory
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>Admin inventory</h1>
        <p style={{ fontSize: 14, color: "var(--c16-ink-3)", marginTop: 8 }}>
          Read-only snapshot of MindBody + HubSpot + Cedarwind state. Generated{" "}
          <time>{new Date().toISOString()}</time>. Class occurrence window: {inv.window.startISO}{" "}
          → {inv.window.endISO}.
        </p>
        <nav
          style={{
            marginTop: 16,
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <a href="#mb" style={{ color: "var(--c16-ink)" }}>
            MindBody ↓
          </a>
          <a href="#hs" style={{ color: "var(--c16-ink)" }}>
            HubSpot ↓
          </a>
          <a href="#app" style={{ color: "var(--c16-ink)" }}>
            Cedarwind app ↓
          </a>
        </nav>
      </header>

      {/* ─── MindBody ─────────────────────────────────────────── */}
      <h2 id="mb" style={{ fontSize: 22, fontWeight: 700, margin: "32px 0 18px" }}>
        MindBody · Ridge Hill (Site 5748154)
      </h2>

      <Section
        id="mb-sites"
        title="Sites the API key has access to"
        bag={inv.mbSites}
        render={(data) => {
          const sites = (data as { Sites: Array<{ Id: number; Name: string; TimeZone?: string }> })
            .Sites;
          return (
            <Table
              headers={["Site Id", "Name", "Time zone"]}
              rows={sites.map((s) => [s.Id, s.Name, s.TimeZone])}
            />
          );
        }}
      />

      <Section
        id="mb-programs"
        title="Programs"
        subtitle="Top-level service categories. ScheduleType `Class` = drop-in style; `Enrollment` = multi-week courses; `Appointment` = privates/rentals."
        bag={inv.mbPrograms}
        render={(data) => {
          const programs = (
            data as {
              Programs: Array<{
                Id: number;
                Name: string;
                ScheduleType: string;
                CancelOffset?: number;
              }>;
            }
          ).Programs;
          return (
            <Table
              headers={["Id", "Name", "ScheduleType", "Cancel offset (hr)"]}
              rows={programs
                .sort((a, b) => a.Id - b.Id)
                .map((p) => [p.Id, p.Name, p.ScheduleType, p.CancelOffset])}
            />
          );
        }}
      />

      <Section
        id="mb-class-descriptions"
        title="Class Descriptions (templates)"
        subtitle="Recipes for classes. Each lives inside a Program. The recurring Schedules below turn these into actual occurrences."
        bag={inv.mbClassDescriptions}
        render={(data) => {
          const cds = (
            data as {
              ClassDescriptions: Array<{
                Id: number;
                Name: string;
                Program?: { Id?: number; Name?: string };
                SessionType?: { Id?: number; Name?: string };
                LastUpdated?: string;
              }>;
            }
          ).ClassDescriptions;
          return (
            <Table
              headers={["Id", "Name", "Program", "Session type", "Last updated"]}
              rows={cds
                .sort((a, b) => a.Id - b.Id)
                .map((c) => [
                  c.Id,
                  c.Name,
                  c.Program ? `${c.Program.Id} · ${c.Program.Name}` : null,
                  c.SessionType?.Name ?? null,
                  c.LastUpdated?.slice(0, 19) ?? null,
                ])}
            />
          );
        }}
      />

      <Section
        id="mb-class-schedules"
        title="Class Schedules (recurrence rules)"
        subtitle="The recurring rules that generate Class occurrences. If a Class Description has 0 Schedules, no occurrences exist for it."
        bag={inv.mbClassSchedules}
        empty="No schedules — likely the source of an empty calendar."
        render={(data) => {
          const schedules = (
            data as {
              ClassSchedules: Array<{
                Id: number;
                ClassDescription?: { Name?: string };
                DaysOfWeek?: string | string[] | null;
                StartTime?: string;
                EndTime?: string;
                StartDate?: string;
                EndDate?: string;
                IsAvailable?: boolean;
              }>;
            }
          ).ClassSchedules;
          return (
            <Table
              headers={[
                "Id",
                "Class Description",
                "Days",
                "Start",
                "End",
                "Range",
                "Available?",
              ]}
              rows={schedules.slice(0, 60).map((s) => [
                s.Id,
                s.ClassDescription?.Name ?? null,
                Array.isArray(s.DaysOfWeek)
                  ? s.DaysOfWeek.join(", ")
                  : (s.DaysOfWeek as string) ?? null,
                s.StartTime?.slice(11, 16) ?? null,
                s.EndTime?.slice(11, 16) ?? null,
                `${s.StartDate?.slice(0, 10) ?? "?"} → ${s.EndDate?.slice(0, 10) ?? "?"}`,
                s.IsAvailable ? "yes" : "no",
              ])}
            />
          );
        }}
      />

      <Section
        id="mb-classes"
        title="Class occurrences (this 60-day window)"
        subtitle={`Live scheduled classes between ${inv.window.startISO} and ${inv.window.endISO}. Shows the first 60 to keep the page scannable; full count in the header.`}
        bag={inv.mbClasses}
        render={(data) => {
          const d = data as {
            PaginationResponse?: { TotalResults?: number };
            Classes: Array<{
              Id: number;
              StartDateTime?: string;
              ClassDescription?: { Name?: string; Program?: { Name?: string } };
              Staff?: { Name?: string };
              MaxCapacity?: number;
              TotalBooked?: number;
              WebCapacity?: number;
              WebBooked?: number;
            }>;
          };
          const total = d.PaginationResponse?.TotalResults ?? d.Classes.length;
          return (
            <>
              <div style={{ fontSize: 12, color: "var(--c16-ink-3)", marginBottom: 8 }}>
                {total} total occurrences in window
              </div>
              <Table
                headers={["Id", "Start", "Class", "Program", "Coach", "Cap / booked", "Web cap"]}
                rows={d.Classes.slice(0, 60).map((c) => [
                  c.Id,
                  c.StartDateTime?.slice(0, 16).replace("T", " ") ?? null,
                  c.ClassDescription?.Name ?? null,
                  c.ClassDescription?.Program?.Name ?? null,
                  c.Staff?.Name ?? null,
                  `${c.TotalBooked ?? 0} / ${c.MaxCapacity ?? 0}`,
                  `${c.WebBooked ?? 0} / ${c.WebCapacity ?? 0}`,
                ])}
              />
            </>
          );
        }}
      />

      <Section
        id="mb-services"
        title="Services / Pricing options"
        subtitle="What's for sale. The IDs here are what `serviceIdByLocation` in `config/adult-config.ts` references, and `100328` is the Kid's Trial $0 used by `/api/staff/confirm`."
        bag={inv.mbServices}
        render={(data) => {
          const services = (
            data as {
              Services: Array<{
                Id: string;
                Name: string;
                Price?: number;
                OnlinePrice?: number;
              }>;
            }
          ).Services;
          return (
            <Table
              headers={["Id", "Name", "Price", "Online price"]}
              rows={services
                .sort((a, b) => a.Name.localeCompare(b.Name))
                .slice(0, 60)
                .map((s) => [
                  s.Id,
                  s.Name,
                  s.Price != null ? `$${Number(s.Price).toFixed(2)}` : null,
                  s.OnlinePrice != null ? `$${Number(s.OnlinePrice).toFixed(2)}` : null,
                ])}
            />
          );
        }}
      />

      <Section
        id="mb-staff"
        title="Staff (coaches)"
        bag={inv.mbStaff}
        render={(data) => {
          const staff = (
            data as {
              StaffMembers: Array<{
                Id: number;
                FirstName?: string;
                LastName?: string;
              }>;
            }
          ).StaffMembers;
          return (
            <Table
              headers={["Id", "Name"]}
              rows={staff.map((s) => [s.Id, `${s.FirstName ?? ""} ${s.LastName ?? ""}`.trim()])}
            />
          );
        }}
      />

      <Section
        id="mb-resources"
        title="Resources (courts / equipment)"
        bag={inv.mbResources}
        render={(data) => {
          const resources = (data as { Resources: Array<{ Id: number; Name?: string }> }).Resources;
          return (
            <Table
              headers={["Id", "Name"]}
              rows={resources.map((r) => [r.Id, r.Name ?? null])}
            />
          );
        }}
      />

      <Section
        id="mb-relationships"
        title="Client relationship catalog"
        subtitle="Site-specific. `-4 Pays For` is what /api/book/trial uses for parent → child."
        bag={inv.mbRelationships}
        render={(data) => {
          const rels = (
            data as {
              Relationships: Array<{
                Id: number;
                RelationshipName1?: string;
                RelationshipName2?: string;
              }>;
            }
          ).Relationships;
          return (
            <Table
              headers={["Id", "Side 1", "Side 2"]}
              rows={rels.map((r) => [r.Id, r.RelationshipName1, r.RelationshipName2])}
            />
          );
        }}
      />

      <Section
        id="mb-required-fields"
        title="Required client fields (Consumer Mode AddClient)"
        subtitle="Which fields a consumer-mode AddClient call must include. Our booking app provides all of these as defaults when the form doesn't capture them (address from location, gender = `Female` placeholder, etc.)."
        bag={inv.mbRequiredFields}
        render={(data) => {
          const fields = (data as { RequiredClientFields: string[] }).RequiredClientFields;
          return (
            <Table
              headers={["Field"]}
              rows={fields.map((f) => [f])}
            />
          );
        }}
      />

      {/* ─── HubSpot ─────────────────────────────────────────── */}
      <h2 id="hs" style={{ fontSize: 22, fontWeight: 700, margin: "32px 0 18px" }}>
        HubSpot · Court 16 portal 4832170
      </h2>

      <Section
        id="hs-deals"
        title="Recent Trials pipeline Deals (latest 50)"
        subtitle="Pipeline KIDS TRIALS (RIDGE HILL). The Deal stage IDs come from Stuart's pipeline-creation step in Spec 2."
        bag={inv.hsTrialDeals}
        render={(data) => {
          const deals = (
            data as {
              results: Array<{
                id: string;
                properties: Record<string, string | null>;
              }>;
            }
          ).results;
          return (
            <Table
              headers={[
                "Deal Id",
                "Created",
                "Name",
                "Stage Id",
                "Class date",
                "Amount",
                "Correlation",
              ]}
              rows={deals.map((d) => [
                d.id,
                d.properties.createdate?.slice(0, 10) ?? null,
                d.properties.dealname,
                d.properties.dealstage,
                d.properties.class_date?.slice(0, 16).replace("T", " ") ?? null,
                d.properties.amount ?? null,
                d.properties.court16_correlation_id,
              ])}
            />
          );
        }}
      />

      <Section
        id="hs-contacts"
        title="Cedarwind new-flow Contacts (latest 50)"
        subtitle="Contacts where court16_correlation_id is set — i.e. came in via the new booking app."
        bag={inv.hsCedarwindContacts}
        render={(data) => {
          const contacts = (
            data as {
              results: Array<{
                id: string;
                properties: Record<string, string | null>;
              }>;
            }
          ).results;
          return (
            <Table
              headers={[
                "Contact Id",
                "Created",
                "Name",
                "Email",
                "Status",
                "Class id",
                "Location",
                "MB parent / child",
              ]}
              rows={contacts.map((c) => [
                c.id,
                c.properties.createdate?.slice(0, 10) ?? null,
                `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim(),
                c.properties.email,
                c.properties.court16_booking_status,
                c.properties.court16_class_id,
                c.properties.court16_location_slug,
                `${c.properties.court16_mindbody_parent_id ?? "—"} / ${
                  c.properties.court16_mindbody_child_id ?? "—"
                }`,
              ])}
            />
          );
        }}
      />

      <Section
        id="hs-properties"
        title="Custom court16_* Contact properties"
        subtitle="Schema we shipped in Spec 1. If anything is missing here, the booking app's contact upsert will 400."
        bag={inv.hsCourt16Properties}
        render={(data) => {
          const props = (
            data as {
              results: Array<{ name: string; type?: string; fieldType?: string; label?: string }>;
            }
          ).results.filter((p) => p.name.startsWith("court16_"));
          return (
            <Table
              headers={["Name", "Label", "Type", "Field type"]}
              rows={props
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => [p.name, p.label, p.type, p.fieldType])}
            />
          );
        }}
      />

      <Section
        id="hs-workflows"
        title="HubSpot Workflows (Package A + Court 16 legacy)"
        subtitle="Active workflows that trigger on our Contacts. The 4 [Cedarwind] workflows are Spec 6+7+denial+confirm. Legacy Court 16 workflows shown for visibility — narrowed via Stage H suppression list where relevant."
        bag={inv.hsWorkflows}
        render={(data) => {
          const flows = (data as { results: Array<{ id: string; name: string; isEnabled: boolean }> })
            .results;
          const cedarwind = flows.filter((f) => f.name.includes("Cedarwind"));
          const others = flows.filter(
            (f) => !f.name.includes("Cedarwind") && (f.isEnabled ?? false),
          );
          return (
            <>
              <div
                style={{ fontSize: 12, color: "var(--c16-ink-3)", marginBottom: 4, marginTop: 4 }}
              >
                Cedarwind-owned workflows
              </div>
              <Table
                headers={["Id", "Name", "Enabled"]}
                rows={cedarwind.map((w) => [w.id, w.name, w.isEnabled ? "yes" : "no"])}
              />
              <div
                style={{ fontSize: 12, color: "var(--c16-ink-3)", margin: "14px 0 4px" }}
              >
                Other enabled Court 16 workflows (first 30)
              </div>
              <Table
                headers={["Id", "Name", "Enabled"]}
                rows={others.slice(0, 30).map((w) => [w.id, w.name, "yes"])}
              />
            </>
          );
        }}
      />

      <Section
        id="hs-emails"
        title="HubSpot marketing email assets (Cedarwind + denial variants)"
        bag={inv.hsTrialEmails}
        render={(data) => {
          const all = (
            data as {
              results: Array<{
                id: string;
                name: string;
                state?: string;
                subject?: string;
                isPublished?: boolean;
              }>;
            }
          ).results;
          const ours = all.filter((e) => e.name.startsWith("[Cedarwind]"));
          return (
            <Table
              headers={["Id", "Name", "State", "Published?", "Subject"]}
              rows={ours
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((e) => [
                  e.id,
                  e.name,
                  e.state,
                  e.isPublished ? "yes" : "no",
                  e.subject ?? null,
                ])}
            />
          );
        }}
      />

      {/* ─── Cedarwind app ──────────────────────────────────────── */}
      <h2 id="app" style={{ fontSize: 22, fontWeight: 700, margin: "32px 0 18px" }}>
        Cedarwind app · runtime state
      </h2>

      <section style={{ marginBottom: 36 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Environment</h3>
        <div
          style={{
            background: "var(--c16-paper)",
            border: "1px solid var(--c16-line)",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <Table
            headers={["Key", "Value"]}
            rows={[
              ["MINDBODY_BASE_URL", mbConfig?.baseUrl ?? "not set"],
              ["MINDBODY_SITE_ID (fallback)", mbConfig?.siteId ?? "not set"],
              ["MINDBODY_WRITE_MODE", mbConfig?.writeMode ?? "not set"],
              [
                "MINDBODY_USE_SANDBOX_FALLBACK",
                process.env.MINDBODY_USE_SANDBOX_FALLBACK ?? "(default: false)",
              ],
              ["HUBSPOT_PORTAL_ID", hsConfig?.portalId ?? "not set"],
              ["HUBSPOT_TRIAL_FORM_GUID", hsConfig?.trialFormGuid ?? "not set"],
              ["HUBSPOT_ACCESS_TOKEN", hsConfig?.accessToken ? "set ✓" : "not set"],
              ["APP_BASE_URL", process.env.APP_BASE_URL ?? "not set"],
              ["INVENTORY_ACCESS_KEY", "set ✓ (you got here)"],
            ]}
          />
        </div>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Cedarwind locations</h3>
        <div
          style={{
            background: "var(--c16-paper)",
            border: "1px solid var(--c16-line)",
            borderRadius: 8,
            padding: 14,
            overflowX: "auto",
          }}
        >
          <Table
            headers={["Slug", "Name", "MindBody Site Id", "kid trial program", "Timezone"]}
            rows={LOCATIONS.map((l) => [
              l.id,
              l.fullName,
              l.siteId,
              (l as { kidTrialProgramId?: number }).kidTrialProgramId ?? null,
              l.timezone,
            ])}
          />
        </div>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Quick links</h3>
        <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <a href="/tracker.html" style={{ color: "var(--c16-ink)" }}>
              /tracker.html
            </a>{" "}
            — Phase 2 status board
          </li>
          <li>
            <a href="/package-a/smoke-tests.html" style={{ color: "var(--c16-ink)" }}>
              /package-a/smoke-tests.html
            </a>{" "}
            — 10 smoke scenarios + gate state
          </li>
          <li>
            <a href="/package-a/ibtissam-handoff.html" style={{ color: "var(--c16-ink)" }}>
              /package-a/ibtissam-handoff.html
            </a>{" "}
            — email copy + workflow walkthrough for Ibtissam
          </li>
          <li>
            <a href="/api/health" style={{ color: "var(--c16-ink)" }}>
              /api/health
            </a>{" "}
            — env state JSON
          </li>
          <li>
            <a
              href={`/api/mindbody/calendar?locationId=${getLocationById("ridgehill")?.id}&startDate=${inv.window.startISO}&endDate=${inv.window.endISO}&intent=kid_trial`}
              style={{ color: "var(--c16-ink)" }}
            >
              /api/mindbody/calendar?intent=kid_trial (RH)
            </a>{" "}
            — the filtered calendar used by /trial
          </li>
          <li>
            <a href="/admin/trial-v5?key=<INVENTORY_ACCESS_KEY>" style={{ color: "var(--c16-ink)" }}>
              /admin/trial-v5
            </a>{" "}
            — side-by-side v5 SOAP vs v6 REST diff (paste the access key into the URL)
          </li>
        </ul>
      </section>
    </main>
  );
}
