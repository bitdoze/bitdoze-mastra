import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchSearch } from "./yahoo-finance-client";

// Look up a stock ticker by company name or partial symbol. Use before
// fetching quotes when you only know the company name (e.g. "Palantir" ->
// PLTR) to avoid guessing the symbol.
export const stockSearch = createTool({
    id: "stock_search",
    description:
        "Find a US stock ticker by company name or partial symbol. Returns matching symbols with their exchange, quote type, and sector. Use when you only know the company name.",
    inputSchema: z.object({
        query: z
            .string()
            .describe("Company name or partial ticker, e.g. 'Palantir', 'Tesla', 'NV'"),
    }),
    outputSchema: z.object({
        query: z.string(),
        results: z.array(
            z.object({
                symbol: z.string(),
                name: z.string().optional(),
                exchange: z.string().optional(),
                quoteType: z.string().optional(),
                sector: z.string().optional(),
                industry: z.string().optional(),
            }),
        ),
        error: z.string().optional(),
    }),
    execute: async (input) => {
        try {
            const quotes = await fetchSearch(input.query, 10);
            return {
                query: input.query,
                results: quotes.map((q) => ({
                    symbol: q.symbol,
                    name: q.longname ?? q.shortname,
                    exchange: q.exchange,
                    quoteType: q.quoteType,
                    sector: q.sector,
                    industry: q.industry,
                })),
            };
        } catch (err) {
            return {
                query: input.query,
                results: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});
