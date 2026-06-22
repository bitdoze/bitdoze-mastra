import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTinyFish } from "./tinyfish-client";

// Wraps @tiny-fish/sdk client.fetch.getContents(). Per-URL failures surface in
// errors[] without failing the whole call. text is null when extraction fails.
export const tinyfishFetch = createTool({
  id: "tinyfish_fetch",
  description:
    "Fetch clean readable content from up to 10 URLs with TinyFish. Returns markdown text (default), title, and description per URL. Use after tinyfish_search to read full page content. Private IPs and localhost are rejected server-side.",
  inputSchema: z.object({
    urls: z
      .array(z.string().url())
      .min(1)
      .max(10)
      .describe("URLs to fetch (http/https only, max 10)."),
    format: z
      .enum(["markdown", "html", "json"])
      .optional()
      .describe("Output format. markdown (default) is best for LLM consumption."),
    links: z
      .boolean()
      .optional()
      .describe("Include all <a href> URLs found on the page."),
    image_links: z
      .boolean()
      .optional()
      .describe("Include all <img src> URLs found on the page."),
    ttl: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Cache freshness tolerance in seconds. 0 = prefer live fetch."),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        url: z.string(),
        final_url: z.string().nullable(),
        title: z.string().nullable(),
        description: z.string().nullable(),
        text: z.unknown(),
        format: z.string(),
      }),
    ),
    errors: z.array(
      z.object({
        url: z.string(),
        error: z.string(),
      }),
    ),
  }),
  execute: async (input) => {
    const client = getTinyFish();
    const res = await client.fetch.getContents({
      urls: input.urls,
      ...(input.format ? { format: input.format } : {}),
      ...(input.links !== undefined ? { links: input.links } : {}),
      ...(input.image_links !== undefined ? { image_links: input.image_links } : {}),
      ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
    });

    return {
      results: res.results.map((r) => ({
        url: r.url,
        final_url: r.final_url,
        title: r.title,
        description: r.description,
        text: r.text,
        format: r.format,
      })),
      errors: res.errors.map((e) => ({ url: e.url, error: e.error })),
    };
  },
});
