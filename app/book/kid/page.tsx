"use client";

import { useEffect, useState } from "react";

interface ClassOption {
  Id?: number;
  ClassId?: number;
  StartDateTime?: string;
  EndDateTime?: string;
  ClassDescription?: { Name?: string };
  Staff?: { Name?: string };
}
interface TrialResult {
  ok: boolean;
  correlationId: string;
  status?: string;
  hubspotContactId?: string | null;
  hubspotBookingId?: string | null;
  parentId?: string | number | null;
  childId?: string | number | null;
  trace?: Array<{ step: string; status: string }>;
  error?: unknown;
  errors?: string[];
}

const LOCATIONS = [
  { slug: "nyc-union-sq", name: "NYC — Union Square" },
  { slug: "nyc-brooklyn", name: "NYC — Brooklyn" },
  { slug: "nyc-long-island-city", name: "NYC — Long Island City" },
  { slug: "nyc-upper-west-side", name: "NYC — Upper West Side" },
  { slug: "nyc-chelsea", name: "NYC — Chelsea" },
  { slug: "nyc-harlem", name: "NYC — Harlem" },
];

export default function KidBooking() {
  const [step, setStep] = useState<"location" | "parent" | "child" | "class" | "waiver" | "submitting" | "done">("location");
  const [location, setLocation] = useState("");
  const [parent, setParent] = useState({ firstName: "", lastName: "", email: "", mobilePhone: "", birthDate: "" });
  const [child, setChild] = useState({ firstName: "", lastName: "", age: "", comfortLevel: "beginner", birthDate: "" });
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [waiver, setWaiver] = useState(false);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(false);

  useEffect(() => {
    if (step !== "class" || !location) return;
    setLoadingClasses(true);
    const age = Number(child.age) || undefined;
    const params = new URLSearchParams({ location });
    if (age) {
      params.set("ageMin", String(Math.max(3, age - 1)));
      params.set("ageMax", String(Math.min(18, age + 1)));
    }
    params.set("programType", "trial");
    params.set("limit", "20");
    fetch(`/api/calendar?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => setClasses(j.classes ?? []))
      .catch(() => setClasses([]))
      .finally(() => setLoadingClasses(false));
  }, [step, location, child.age]);

  async function submit() {
    setStep("submitting");
    const body = {
      location,
      parent,
      child: { ...child, age: Number(child.age) },
      classId: classId!,
      waiverVersion: "v1.0",
    };
    try {
      const res = await fetch("/api/book/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as TrialResult;
      setResult(json);
      setStep("done");
    } catch (err) {
      setResult({ ok: false, correlationId: "client-error", error: err instanceof Error ? err.message : String(err) });
      setStep("done");
    }
  }

  return (
    <main style={wrap}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#888" }}>Court 16 · Kids trial</div>
      <h1 style={{ fontSize: 24, margin: "4px 0 24px" }}>Book a free trial</h1>

      {step === "location" && (
        <section>
          <Label>Which location?</Label>
          <div style={{ display: "grid", gap: 8 }}>
            {LOCATIONS.map((l) => (
              <button key={l.slug} onClick={() => { setLocation(l.slug); setStep("parent"); }} style={choiceBtn}>
                {l.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "parent" && (
        <section style={section}>
          <Row>
            <Field label="Parent first name"><input required value={parent.firstName} onChange={(e) => setParent({ ...parent, firstName: e.target.value })} style={input} /></Field>
            <Field label="Parent last name"><input required value={parent.lastName} onChange={(e) => setParent({ ...parent, lastName: e.target.value })} style={input} /></Field>
          </Row>
          <Row>
            <Field label="Email"><input required type="email" value={parent.email} onChange={(e) => setParent({ ...parent, email: e.target.value })} style={input} /></Field>
            <Field label="Mobile phone"><input value={parent.mobilePhone} onChange={(e) => setParent({ ...parent, mobilePhone: e.target.value })} style={input} /></Field>
          </Row>
          <Field label="Parent DOB (YYYY-MM-DD)"><input required placeholder="1985-01-01" value={parent.birthDate} onChange={(e) => setParent({ ...parent, birthDate: e.target.value })} style={input} /></Field>
          <button onClick={() => setStep("child")} style={nextBtn}>Next</button>
        </section>
      )}

      {step === "child" && (
        <section style={section}>
          <Row>
            <Field label="Child first name"><input required value={child.firstName} onChange={(e) => setChild({ ...child, firstName: e.target.value })} style={input} /></Field>
            <Field label="Child last name"><input required value={child.lastName} onChange={(e) => setChild({ ...child, lastName: e.target.value })} style={input} /></Field>
          </Row>
          <Row>
            <Field label="Age"><input required type="number" min={3} max={18} value={child.age} onChange={(e) => setChild({ ...child, age: e.target.value })} style={input} /></Field>
            <Field label="Child DOB (YYYY-MM-DD)"><input required placeholder="2017-06-15" value={child.birthDate} onChange={(e) => setChild({ ...child, birthDate: e.target.value })} style={input} /></Field>
          </Row>
          <Field label="Comfort level">
            <select value={child.comfortLevel} onChange={(e) => setChild({ ...child, comfortLevel: e.target.value })} style={input}>
              <option value="beginner">Beginner — never played</option>
              <option value="some-experience">Some experience</option>
              <option value="experienced">Experienced</option>
            </select>
          </Field>
          <button onClick={() => setStep("class")} style={nextBtn}>Next — pick a class</button>
        </section>
      )}

      {step === "class" && (
        <section style={section}>
          <Label>Pick a trial class (next 14 days)</Label>
          {loadingClasses && <div style={{ color: "#888" }}>Loading…</div>}
          {!loadingClasses && classes.length === 0 && (
            <div style={{ color: "#888" }}>
              No sessions found. Try a different location or email <a href="mailto:info@court16.com">info@court16.com</a>.
            </div>
          )}
          {classes.map((c) => {
            const id = c.Id ?? c.ClassId;
            const when = c.StartDateTime ? new Date(c.StartDateTime).toLocaleString() : "TBD";
            const name = c.ClassDescription?.Name ?? "Class";
            return (
              <button key={id} onClick={() => { setClassId(Number(id)); setStep("waiver"); }} style={classBtn}>
                <div style={{ fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{when} · {c.Staff?.Name ?? "Court 16 coach"}</div>
              </button>
            );
          })}
        </section>
      )}

      {step === "waiver" && (
        <section style={section}>
          <Label>Waiver</Label>
          <div style={{ fontSize: 13, color: "#555", border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
            I acknowledge Court 16&apos;s participation waiver and agree to its terms. Full text available on request.
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />
            I agree (waiver v1.0)
          </label>
          <button disabled={!waiver} onClick={submit} style={waiver ? nextBtn : disabledBtn}>Submit trial request</button>
        </section>
      )}

      {step === "submitting" && (
        <section style={section}>
          <div style={{ color: "#888" }}>Submitting…</div>
        </section>
      )}

      {step === "done" && result && (
        <section style={section}>
          {result.ok ? (
            result.status === "duplicate_email_softwall" ? (
              <div>
                <h2 style={{ fontSize: 20 }}>We see you in our system</h2>
                <p style={{ color: "#555" }}>
                  It looks like you&apos;ve been with Court 16 before. Someone on our team will reach out within 24 hours to add this trial for {child.firstName}.
                </p>
                <p style={{ fontSize: 12, color: "#888" }}>Reference: {result.correlationId}</p>
              </div>
            ) : (
              <div>
                <h2 style={{ fontSize: 20 }}>We&apos;re confirming your trial</h2>
                <p style={{ color: "#555" }}>
                  You&apos;ll hear from Court 16 within a few hours with your confirmed class details.
                </p>
                <p style={{ fontSize: 12, color: "#888" }}>Reference: {result.correlationId}</p>
              </div>
            )
          ) : (
            <div>
              <h2 style={{ fontSize: 20, color: "#a52834" }}>Something went wrong</h2>
              <p style={{ color: "#555" }}>Please email <a href="mailto:info@court16.com">info@court16.com</a> with this reference: <code>{result.correlationId}</code></p>
              <pre style={{ background: "#111", color: "#eee", padding: 12, borderRadius: 8, overflow: "auto", fontSize: 11 }}>
{JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#555" }}>{label}{children}</label>;
}

const wrap: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: "48px 24px",
  fontFamily: "system-ui, -apple-system, sans-serif",
};
const section: React.CSSProperties = { display: "grid", gap: 12 };
const input: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid #ddd",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
};
const choiceBtn: React.CSSProperties = {
  padding: "14px 18px",
  fontSize: 15,
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  textAlign: "left",
  cursor: "pointer",
};
const classBtn: React.CSSProperties = { ...choiceBtn };
const nextBtn: React.CSSProperties = {
  padding: "12px 20px",
  fontSize: 14,
  fontWeight: 600,
  background: "#111",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 8,
};
const disabledBtn: React.CSSProperties = { ...nextBtn, background: "#ccc", cursor: "not-allowed" };
