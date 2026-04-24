"use client";

import { useState } from "react";

type StepStatus = "ok" | "skipped" | "error";
interface TraceEntry {
  step: string;
  status: StepStatus;
  data?: unknown;
  error?: unknown;
}
interface HappyPathResult {
  ok: boolean;
  correlationId: string;
  writeMode?: string;
  parentId?: string | number;
  childId?: string | number;
  trace?: TraceEntry[];
  error?: unknown;
  errors?: string[];
}

const DEFAULTS = {
  parentFirstName: "Taylor",
  parentLastName: "Parent",
  parentEmail: "",
  parentMobile: "212-555-0123",
  parentBirthDate: "1985-01-01",
  childFirstName: "Avery",
  childLastName: "Kid",
  childBirthDate: "2017-06-15",
  classId: "",
  bearerToken: "",
};

export default function Home() {
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HappyPathResult | null>(null);

  function update<K extends keyof typeof DEFAULTS>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const body = {
        parent: {
          firstName: form.parentFirstName,
          lastName: form.parentLastName,
          email: form.parentEmail,
          mobilePhone: form.parentMobile || undefined,
          birthDate: form.parentBirthDate || undefined,
        },
        child: {
          firstName: form.childFirstName,
          lastName: form.childLastName,
          birthDate: form.childBirthDate,
        },
        classId: form.classId ? Number(form.classId) : undefined,
      };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (form.bearerToken) headers.Authorization = `Bearer ${form.bearerToken}`;
      const res = await fetch("/api/mindbody/happy-path", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HappyPathResult;
      setResult(json);
    } catch (err) {
      setResult({
        ok: false,
        correlationId: "client-error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#888" }}>
          Court 16 · Cedarwind
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 8px" }}>MindBody Happy-Path Test</h1>
        <p style={{ color: "#555", margin: 0 }}>
          Runs: GetClients → AddClient (parent, if new) → AddClient (child) → AddClientRelationship → AddClientToClass.
          All writes go in <code>Test</code> mode until <code>MINDBODY_WRITE_MODE=live</code>.
        </p>
      </header>

      <form onSubmit={submit} style={{ display: "grid", gap: 16, background: "#fff", padding: 20, borderRadius: 8, border: "1px solid #eee" }}>
        <Section title="Parent">
          <Row>
            <Field label="First name"><input required value={form.parentFirstName} onChange={(e) => update("parentFirstName", e.target.value)} style={input} /></Field>
            <Field label="Last name"><input required value={form.parentLastName} onChange={(e) => update("parentLastName", e.target.value)} style={input} /></Field>
          </Row>
          <Row>
            <Field label="Email"><input required type="email" placeholder="stuart+run1@cedarwind.io" value={form.parentEmail} onChange={(e) => update("parentEmail", e.target.value)} style={input} /></Field>
            <Field label="Mobile (optional)"><input value={form.parentMobile} onChange={(e) => update("parentMobile", e.target.value)} style={input} /></Field>
          </Row>
          <Row>
            <Field label="Birth date (YYYY-MM-DD)"><input required value={form.parentBirthDate} onChange={(e) => update("parentBirthDate", e.target.value)} style={input} /></Field>
            <Field label=""><span /></Field>
          </Row>
        </Section>

        <Section title="Child">
          <Row>
            <Field label="First name"><input required value={form.childFirstName} onChange={(e) => update("childFirstName", e.target.value)} style={input} /></Field>
            <Field label="Last name"><input required value={form.childLastName} onChange={(e) => update("childLastName", e.target.value)} style={input} /></Field>
          </Row>
          <Row>
            <Field label="Birth date (YYYY-MM-DD)"><input required value={form.childBirthDate} onChange={(e) => update("childBirthDate", e.target.value)} style={input} /></Field>
            <Field label="ClassId (optional)"><input placeholder="grab one from /api/mindbody/classes" value={form.classId} onChange={(e) => update("classId", e.target.value)} style={input} /></Field>
          </Row>
        </Section>

        <Section title="Auth (only if TEST_API_TOKEN set)">
          <Field label="Bearer token (optional)">
            <input type="password" placeholder="leave blank if TEST_API_TOKEN is not set" value={form.bearerToken} onChange={(e) => update("bearerToken", e.target.value)} style={input} />
          </Field>
        </Section>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="submit" disabled={loading} style={button}>{loading ? "Running…" : "Run happy path"}</button>
          <a href="/api/health" style={link}>health</a>
          <a href="/api/mindbody/classes?limit=10" style={link}>list classes</a>
        </div>
      </form>

      {result && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
            Result{" "}
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 12,
              background: result.ok ? "#e6f7ee" : "#fdecea",
              color: result.ok ? "#116b3a" : "#a52834",
              marginLeft: 8,
            }}>
              {result.ok ? "OK" : "FAIL"}
            </span>
            {result.writeMode && (
              <span style={{ fontSize: 11, marginLeft: 8, padding: "2px 8px", borderRadius: 12, background: result.writeMode === "live" ? "#fff5d6" : "#eef", color: "#333" }}>
                writeMode: {result.writeMode}
              </span>
            )}
          </h2>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>correlationId: <code>{result.correlationId}</code></div>
          {result.trace && (
            <ol style={{ paddingLeft: 20, margin: "0 0 16px" }}>
              {result.trace.map((t, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <strong>{t.step}</strong>{" "}
                  <span style={{ fontSize: 11, color: t.status === "ok" ? "#116b3a" : t.status === "skipped" ? "#888" : "#a52834" }}>
                    [{t.status}]
                  </span>
                </li>
              ))}
            </ol>
          )}
          <pre style={{ background: "#111", color: "#eee", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 12 }}>
{JSON.stringify(result, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
      <legend style={{ padding: "0 6px", fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </legend>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </fieldset>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#555" }}>
      {label}
      {children}
    </label>
  );
}

const input: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid #ddd",
  borderRadius: 6,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const button: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  background: "#111",
  color: "#fff",
  border: 0,
  borderRadius: 6,
  cursor: "pointer",
};
const link: React.CSSProperties = {
  fontSize: 12,
  color: "#555",
  textDecoration: "underline",
};
