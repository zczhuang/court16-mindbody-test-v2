/**
 * Minimal GitHub Issues client for the Phase 2 tracker comment store.
 * The repo is private, so every read/write goes through this server-side
 * helper using TRACKER_GITHUB_TOKEN — the browser never sees the token.
 */

export interface TrackerConfig {
  token: string;
  owner: string;
  repo: string;
  label: string;
}

export function loadTrackerConfig(): TrackerConfig | null {
  const token = process.env.TRACKER_GITHUB_TOKEN;
  if (!token) return null;
  return {
    token,
    owner: process.env.TRACKER_REPO_OWNER ?? "zczhuang",
    repo: process.env.TRACKER_REPO_NAME ?? "court16-tracker-comments",
    label: process.env.TRACKER_LABEL ?? "tracker-feedback",
  };
}

const GH_API = "https://api.github.com";

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  created_at: string;
  html_url: string;
  user?: { login?: string };
}

async function ghFetch<T>(
  cfg: TrackerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function createComment(
  cfg: TrackerConfig,
  from: string,
  text: string,
): Promise<{ number: number; html_url: string }> {
  // Title is the author label + short snippet so Stuart's GitHub email
  // notifications are scannable without opening each issue.
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 60);
  const title = `[Tracker] ${from}: ${snippet}${text.length > 60 ? "…" : ""}`;
  const body = [
    `**From:** ${from}`,
    "",
    text.trim(),
    "",
    "---",
    `_Posted via Phase 2 tracker · ${new Date().toISOString()}_`,
  ].join("\n");
  const issue = await ghFetch<GhIssue>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/issues`,
    {
      method: "POST",
      body: JSON.stringify({ title, body, labels: [cfg.label] }),
    },
  );
  return { number: issue.number, html_url: issue.html_url };
}

export interface TrackerComment {
  id: number;
  from: string;
  text: string;
  createdAt: string;
  state: "open" | "closed";
  url: string;
}

export async function listComments(cfg: TrackerConfig): Promise<TrackerComment[]> {
  // Include closed so Stuart's "mark resolved" on GitHub greys them out in
  // the dash instead of removing them. GH paginates; default 30 is fine
  // until we cross that.
  const issues = await ghFetch<GhIssue[]>(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/issues?state=all&labels=${encodeURIComponent(cfg.label)}&per_page=50&sort=created&direction=desc`,
  );
  return issues.map((iss) => {
    const fromMatch = (iss.body ?? "").match(/^\*\*From:\*\*\s+(.+)$/m);
    const from = fromMatch ? fromMatch[1].trim() : iss.user?.login ?? "Anonymous";
    const text = (iss.body ?? "")
      .replace(/^\*\*From:\*\*.*$/m, "")
      .replace(/---\s*\n_Posted via.*?_$/ms, "")
      .trim();
    return {
      id: iss.number,
      from,
      text,
      createdAt: iss.created_at,
      state: iss.state,
      url: iss.html_url,
    };
  });
}
