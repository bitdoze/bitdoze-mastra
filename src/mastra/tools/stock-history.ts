import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchChart } from "./market-data";

// Historical OHLCV candles for a US stock. Used to compute technical context
// (recent trend, support/resistance, momentum) for daily trade decisions.
// Range + interval map to Yahoo Finance's chart params:
//   range: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, ytd, max
//   interval: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo (must be valid for the range)
export const stockHistory = createTool({
    id: "stock_history",
    description:
        "Fetch historical OHLCV candles for a US stock. Use to analyze recent trend, momentum, and support/resistance before recommending a trade. Returns timestamped open/high/low/close/volume.",
    inputSchema: z.object({
        symbol: z.string().describe("Stock ticker, e.g. AAPL, NVDA"),
        range: z
            .enum(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"])
            .default("1mo")
            .describe("Time range to fetch"),
        interval: z
            .enum(["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"])
            .default("1d")
            .describe("Candle interval"),
    }),
    outputSchema: z.object({
        symbol: z.string(),
        range: z.string(),
        interval: z.string(),
        candles: z.array(
            z.object({
                time: z.string(),
                open: z.number().nullable(),
                high: z.number().nullable(),
                low: z.number().nullable(),
                close: z.number().nullable(),
                volume: z.number().nullable(),
            }),
        ),
        previousClose: z.number().optional(),
        error: z.string().optional(),
    }),
    execute: async (input) => {
        try {
            const chart = await fetchChart(
                input.symbol,
                input.range,
                input.interval,
            );
            const candles = chart.timestamps.map((ts, i) => ({
                time: new Date(ts * 1000).toISOString(),
                open: chart.open[i] ?? null,
                high: chart.high[i] ?? null,
                low: chart.low[i] ?? null,
                close: chart.close[i] ?? null,
                volume: chart.volume[i] ?? null,
            }));
            return {
                symbol: chart.meta.symbol ?? input.symbol.toUpperCase(),
                range: input.range,
                interval: input.interval,
                candles,
                previousClose: chart.meta.previousClose,
            };
        } catch (err) {
            return {
                symbol: input.symbol.toUpperCase(),
                range: input.range,
                interval: input.interval,
                candles: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});
