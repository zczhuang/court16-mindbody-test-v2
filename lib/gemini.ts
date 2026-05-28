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

/**
 * Vercel Workload Identity Federation path: exchange the per-function
 * VERCEL_OIDC_TOKEN for a federated GCP token via STS, then impersonate the
 * configured service account to get an access token usable for Vertex AI.
 *
 * Falls back to ADC (`google-auth-library`) when VERCEL_OIDC_TOKEN isn't
 * present — that's the local-dev path on a machine running `gcloud auth
 * application-default login`.
 */
async function getAccessToken(): Promise<string> {
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  const wip = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  const saEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (oidc && wip && saEmail) {
    // 1. Trade Vercel OIDC JWT for a federated Google access token.
    const stsResp = await fetch("https://sts.googleapis.com/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: `//iam.googleapis.com/${wip}`,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: oidc,
      }).toString(),
    });
    const sts = (await stsResp.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!stsResp.ok || !sts.access_token) {
      throw new Error(`STS exchange failed (${stsResp.status}): ${sts.error_description || sts.error || JSON.stringify(sts)}`);
    }

    // 2. Use the federated token to impersonate the service account.
    const impUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:generateAccessToken`;
    const impResp = await fetch(impUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sts.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scope: SCOPES }),
    });
    const imp = (await impResp.json()) as { accessToken?: string; error?: { message?: string } };
    if (!impResp.ok || !imp.accessToken) {
      throw new Error(`SA impersonation failed (${impResp.status}): ${imp.error?.message || JSON.stringify(imp)}`);
    }
    return imp.accessToken;
  }

  // Local ADC path.
  const client = await getAuth().getClient();
  const tok = await client.getAccessToken();
  if (!tok?.token) throw new Error("ADC returned no access token");
  return tok.token;
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

  const token = await getAccessToken();

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
