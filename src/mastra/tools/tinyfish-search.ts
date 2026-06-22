import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTinyFish } from "./tinyfish-client";

// Wraps @tiny-fish/sdk client.search.query(). The API returns `site_name`,
// surfaced here as `domain` for clarity.
export const tinyfishSearch = createTool({
  id: "tinyfish_search",
  description:
    "Search the live web with TinyFish and return ranked results (title, snippet, url, domain). Use for factual questions, current events, or finding pages to read. Supports operators like site: and -site:.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query. Operators like site: and -site: are supported."),
    location: z
      .string()
      .optional()
      .describe("Country code for geo-targeting, e.g. US, GB, FR. Defaults to US."),
    language: z
      .string()
      .optional()
      .describe("Language code for results, e.g. en, fr. Defaults to en."),
    page: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Page number for pagination, starting at 0. Max 10."),
  }),
  outputSchema: z.object({
    query: z.string(),
    total_results: z.number(),
    page: z.number(),
    results: z.array(
      z.object({
        position: z.number(),
        domain: z.string(),
        title: z.string(),
        snippet: z.string(),
        url: z.string(),
      }),
    ),
  }),
  execute: async (input) => {
    const client = getTinyFish();
    const res = await client.search.query({
      query: input.query,
      ...(input.location ? { location: input.location } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.page !== undefined ? { page: input.page } : {}),
    });

    return {
      query: res.query,
      total_results: res.total_results,
      page: res.page,
      results: res.results.map((r) => ({
        position: r.position,
        domain: r.site_name,
        title: r.title,
        snippet: r.snippet,
        url: r.url,
      })),
    };
  },
});
