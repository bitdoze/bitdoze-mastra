import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { githubFetch, daysAgoISO, GithubApiError } from "./github-client";

// Finds trending GitHub repositories via the Search API: repos created within a
// recent window that exceed a star threshold, sorted by stars desc. This is the
// closest programmatic approximation to GitHub's "trending" (which has no API).
export const githubTrending = createTool({
  id: "github_trending_repos",
  description:
    "Find trending GitHub repositories: repos created recently with lots of stars, sorted by popularity. Use for discovering new popular projects, libraries, or tools. Returns name, description, stars, language, and topics. Optional filters: keyword query, language, time window, and minimum stars.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Optional keyword/topic to scope results (e.g. 'agent', 'vector database', 'rust web framework'). Supports GitHub search qualifiers like 'topic:ai'.",
      ),
    language: z
      .string()
      .optional()
      .describe("Primary language filter (e.g. TypeScript, Python, Rust)."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Only repos created within the last N days. Default 7."),
    minStars: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum star count. Default 50 (raised automatically for wider windows)."),
    sort: z
      .enum(["stars", "updated", "best-match"])
      .optional()
      .describe("Sort order. 'stars' (default) surfaces the most popular."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Number of repos to return. Default 10. Max 30."),
  }),
  outputSchema: z.object({
    totalCount: z.number().describe("Total matching repos on GitHub."),
    returned: z.number().describe("Number of repos in this response."),
    repos: z.array(
      z.object({
        fullName: z.string(),
        description: z.string().nullable(),
        url: z.string(),
        stars: z.number(),
        forks: z.number(),
        language: z.string().nullable(),
        topics: z.array(z.string()),
        createdAt: z.string(),
        updatedAt: z.string(),
        license: z.string().nullable(),
      }),
    ),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const days = input.days ?? 7;
    const minStars = input.minStars ?? 50;
    const sort = input.sort ?? "stars";
    const limit = input.limit ?? 10;

    const parts: string[] = [`created:>${daysAgoISO(days)}`, `stars:>=${minStars}`];
    if (input.query) parts.push(input.query);
    if (input.language) parts.push(`language:${input.language}`);

    const q = encodeURIComponent(parts.join(" "));
    const path = `/search/repositories?q=${q}&sort=${sort}&order=desc&per_page=${limit}`;

    try {
      const { data } = await githubFetch<any>(path);
      const items: any[] = data.items ?? [];

      return {
        totalCount: data.total_count ?? 0,
        returned: items.length,
        repos: items.map((r) => ({
          fullName: r.full_name,
          description: r.description ?? null,
          url: r.html_url,
          stars: r.stargazers_count ?? 0,
          forks: r.forks_count ?? 0,
          language: r.language ?? null,
          topics: r.topics ?? [],
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          license: r.license?.spdx_id ?? null,
        })),
      };
    } catch (error) {
      const message =
        error instanceof GithubApiError
          ? error.message
          : `Failed to search GitHub: ${error instanceof Error ? error.message : "Unknown error"}`;
      return { totalCount: 0, returned: 0, repos: [], error: message };
    }
  },
});
