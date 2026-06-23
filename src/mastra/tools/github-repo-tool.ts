import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { githubFetch, GithubApiError } from "./github-client";

// Fetches a single repository's metadata and (optionally) its README markdown.
// Use after github_trending_repos to read the full details / docs of a repo.
export const githubRepo = createTool({
  id: "github_repo",
  description:
    "Fetch detailed metadata for a specific GitHub repository (owner/repo), including stars, forks, topics, default branch, dates, and license. Optionally includes the full README markdown. Use after github_trending_repos to read a repo's docs.",
  inputSchema: z.object({
    repo: z
      .string()
      .describe("Repository as 'owner/repo' (e.g. facebook/react) or full GitHub URL."),
    includeReadme: z
      .boolean()
      .optional()
      .describe("Include the full README markdown. Default true."),
  }),
  outputSchema: z.object({
    fullName: z.string(),
    description: z.string().nullable(),
    url: z.string(),
    homepage: z.string().nullable(),
    stars: z.number(),
    forks: z.number(),
    watchers: z.number(),
    openIssues: z.number(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
    defaultBranch: z.string(),
    license: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    pushedAt: z.string(),
    readme: z.string().nullable().describe("README markdown, or null if not requested/available."),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const ownerRepo = extractOwnerRepo(input.repo);
    if (!ownerRepo) {
      return errorResult(
        "Invalid repository. Provide 'owner/repo' (e.g. facebook/react) or a GitHub URL.",
      );
    }

    try {
      const { data: repo } = await githubFetch<any>(`/repos/${ownerRepo}`);

      let readme: string | null = null;
      if (input.includeReadme !== false) {
        try {
          const { data } = await githubFetch<string>(`/repos/${ownerRepo}/readme`, {
            headers: { Accept: "application/vnd.github.raw" },
          });
          readme = typeof data === "string" ? data : null;
        } catch {
          // README optional — leave null if missing or too large.
        }
      }

      return {
        fullName: repo.full_name,
        description: repo.description ?? null,
        url: repo.html_url,
        homepage: repo.homepage || null,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        watchers: repo.subscribers_count ?? repo.watchers_count ?? 0,
        openIssues: repo.open_issues_count ?? 0,
        language: repo.language ?? null,
        topics: repo.topics ?? [],
        defaultBranch: repo.default_branch,
        license: repo.license?.spdx_id ?? null,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        pushedAt: repo.pushed_at,
        readme,
      };
    } catch (error) {
      const message =
        error instanceof GithubApiError
          ? error.message
          : `Failed to fetch repo: ${error instanceof Error ? error.message : "Unknown error"}`;
      return errorResult(message);
    }
  },
});

function extractOwnerRepo(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/,
  );
  return match?.[1] ?? null;
}

function errorResult(error: string) {
  return {
    fullName: "",
    description: null,
    url: "",
    homepage: null,
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    language: null,
    topics: [],
    defaultBranch: "",
    license: null,
    createdAt: "",
    updatedAt: "",
    pushedAt: "",
    readme: null,
    error,
  };
}
