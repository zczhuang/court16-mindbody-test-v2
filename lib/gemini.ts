/**
 * Gemini (Vertex AI) client using Application Default Credentials.
 *
 * Auth: ADC chain — env `GOOGLE_APPLICATION_CREDENTIALS` (service-account
 * JSON path) → `~/.config/gcloud/application_default_credentials.json` →
 * GCE/Cloud Run metadata server. No API key.
 *
 * Model name is passed verbatim per caller — `gemini-3.1-flash-lite` is
 * what the chatbot uses today.
 */
import { GoogleAuth } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

let _authClient: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_authClient) _authClient = new GoogleAuth({ scopes: SCOPES });
  return _authClient;
}

export interface GeminiMessage {
  role: "user" | "model";
  text: string;
}

export interface GeminiCallOpts {
  model: string;
  systemInstruction: string;
  messages: GeminiMessage[];
  /** Optional JSON Schema for `responseSchema`; forces structured output. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GeminiCallResult {
  text: string;
  /** Parsed JSON if `responseSchema` was supplied and parsing succeeds. */
  json?: unknown;
  raw: unknown;
}

/**
 * Call Vertex AI Gemini's `generateContent`. Uses the regional endpoint
 * `${GCP_REGION}-aiplatform.googleapis.com`.
 */
export async function callGemini(opts: GeminiCallOpts): Promise<GeminiCallResult> {
  const project =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (!project) throw new Error("GCP_PROJECT_ID env var is required for Vertex AI");

  const region = process.env.GCP_REGION || "global";

  // The "global" location uses the bare aiplatform.googleapis.com host
  // (no region prefix). Regional locations use `${region}-aiplatform...`.
  // gemini-3.1-flash-lite is served from the global endpoint as of 2026.
  const host =
    region === "global"
      ? "aiplatform.googleapis.com"
      : `${region}-aiplatform.googleapis.com`;
  const url =
    `https://${host}/v1/projects/${project}/locations/${region}` +
    `/publishers/google/models/${encodeURIComponent(opts.model)}:generateContent`;

  const auth = getAuth();
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new Error("ADC returned no access token");

  const body: Record<string, unknown> = {
    systemInstruction: {
      role: "system",
      parts: [{ text: opts.systemInstruction }],
    },
    contents: opts.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.maxOutputTokens ?? 512,
      ...(opts.responseSchema
        ? { responseMimeType: "application/json", responseSchema: opts.responseSchema }
        : {}),
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";

  let json: unknown;
  if (opts.responseSchema && text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Leave json undefined; caller falls back to raw text.
    }
  }

  return { text, json, raw: data };
}
