import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchChart } from "./market-data";

// Live quote for a US stock: current price, change vs previous close, day
// range, volume, and 52-week range. Built on Yahoo Finance's public chart
// endpoint (the v7 quote endpoint now requires a crumb/cookie). Pulls a 1d
// / 5m chart so we also get today's OHLCV series and the regularMarketPrice.
export const stockQuote = createTool({
    id: "stock_quote",
    description:
        "Get a live quote for a US stock ticker: current price, change and change % vs previous close, day range, volume, and 52-week range. Use for any ticker (e.g. AAPL, NVDA, TSLA).",
    inputSchema: z.object({
        symbol: z.string().describe("Stock ticker, e.g. AAPL, NVDA, MSFT"),
    }),
    outputSchema: z.object({
        symbol: z.string(),
        name: z.string().optional(),
        exchange: z.string().optional(),
        currency: z.string().optional(),
        price: z.number().optional(),
        previousClose: z.number().optional(),
        change: z.number().optional(),
        changePercent: z.number().optional(),
        dayLow: z.number().optional(),
        dayHigh: z.number().optional(),
        volume: z.number().optional(),
        fiftyTwoWeekLow: z.number().optional(),
        fiftyTwoWeekHigh: z.number().optional(),
        error: z.string().optional(),
    }),
    execute: async (input) => {
        try {
            const chart = await fetchChart(input.symbol, "1d", "5m");
            const m = chart.meta;
            const price = m.regularMarketPrice;
            const prev = m.chartPreviousClose ?? m.previousClose;
            const change =
                price !== undefined && prev !== undefined ? price - prev : undefined;
            const changePercent =
                change !== undefined && prev && prev !== 0
                    ? (change / prev) * 100
                    : undefined;
            return {
                symbol: m.symbol ?? input.symbol.toUpperCase(),
                name: m.fullExchangeName,
                exchange: m.exchangeName,
                currency: m.currency,
                price,
                previousClose: prev,
                change,
                changePercent,
                dayLow: m.regularMarketDayLow,
                dayHigh: m.regularMarketDayHigh,
                volume: m.regularMarketVolume,
                fiftyTwoWeekLow: m.fiftyTwoWeekLow,
                fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
            };
        } catch (err) {
            return {
                symbol: input.symbol.toUpperCase(),
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});
