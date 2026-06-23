// Shared GitHub REST client. Uses GITHUB_TOKEN from env when available for
// higher rate limits (authenticated: 30 search/min, 5000 core req/hr). Falls
// back to unauthenticated requests (10 search/min, 60 core req/hr) if no token.
// Throws structured errors that tools catch and surface gracefully.

const GITHUB_API = "https://api.github.com";

export function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

export class GithubApiError extends Error {
  status: number;
  rateLimited: boolean;
  constructor(message: string, status: number, rateLimited = false) {
    super(message);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

// Performs a GitHub API request, authenticated when GITHUB_TOKEN is set.
// `path` is relative to the API root (e.g. "/search/repositories?q=...").
// Throws GithubApiError on non-2xx.
export async function githubFetch<T = any>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; rate: { limit: number; remaining: number; reset: number } }> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mastra-app",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path.startsWith("http") ? path : `${GITHUB_API}${path}`, {
    ...init,
    headers,
  });

  const rate = {
    limit: Number(res.headers.get("X-RateLimit-Limit") ?? 0),
    remaining: Number(res.headers.get("X-RateLimit-Remaining") ?? 0),
    reset: Number(res.headers.get("X-RateLimit-Reset") ?? 0),
  };

  if (res.status === 204) return { data: {} as T, rate };

  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const remaining = Number(res.headers.get("X-RateLimit-Remaining") ?? 1);
    const rateLimited = res.status === 403 || res.status === 429 ? remaining === 0 : false;
    let message: string;
    if (rateLimited) {
      const resetIn = rate.reset ? Math.ceil((rate.reset * 1000 - Date.now()) / 60000) : 0;
      message = `GitHub API rate limit exceeded. Resets in ~${resetIn} min.`;
    } else if (res.status === 401) {
      message = "GitHub authentication failed. Check that GITHUB_TOKEN is a valid token.";
    } else if (res.status === 404) {
      message = "GitHub resource not found.";
    } else {
      message =
        body?.message || body?.errors?.[0]?.message || `GitHub API error (HTTP ${res.status})`;
    }
    throw new GithubApiError(message, res.status, rateLimited);
  }

  return { data: body as T, rate };
}

// YYYY-MM-DD for N days ago — used for the Search API `created:>` filter.
export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}
