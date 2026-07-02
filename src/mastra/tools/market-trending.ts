import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchTrending } from "./yahoo-finance-client";

// Trending US tickers from Yahoo Finance. Useful as a starting universe for
// daily picks — these are the names attracting the most attention today.
export const marketTrending = createTool({
    id: "market_trending",
    description:
        "Get the list of trending US stock tickers on Yahoo Finance right now. Use as a starting universe when scanning for daily trade ideas.",
    inputSchema: z.object({}),
    outputSchema: z.object({
        symbols: z.array(z.string()),
        error: z.string().optional(),
    }),
    execute: async () => {
        try {
            const symbols = await fetchTrending("US");
            return { symbols };
        } catch (err) {
            return {
                symbols: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});
