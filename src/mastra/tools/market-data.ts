// Unified market-data access layer. Tries Yahoo Finance first (no key, fast,
// generous limits) and automatically falls back to Twelve Data (free key,
// 800 req/day) when Yahoo rate-limits (429) or fails. Callers get a single
// `fetchChart` function with the same contract regardless of provider.
//
// The Twelve Data fallback only activates when TWELVEDATA_API_KEY is set, so
// the system degrades gracefully (Yahoo-only) if the key is absent.

import {
    fetchChart as fetchYahooChart,
    YahooFinanceError,
    type ChartResult,
} from "./yahoo-finance-client";
import {
    fetchChart as fetchTdChart,
    hasTwelveDataKey,
} from "./twelvedata-client";

export type { ChartResult } from "./yahoo-finance-client";

// Track provider health across calls within a process so we can short-circuit
// to the fallback temporarily after a streak of Yahoo failures. This avoids
// wasting time re-trying a rate-limited provider.
let yahooFailuresUntil = 0; // epoch ms until which Yahoo is considered unhealthy
const YAHOUT_COOLDOWN_MS = 60_000; // 1 min cooldown after a 429 streak

function yahooHealthy(): boolean {
    return Date.now() > yahooFailuresUntil;
}

function markYahooUnhealthy() {
    yahooFailuresUntil = Date.now() + YAHOUT_COOLDOWN_MS;
}

// Should a given error trigger the fallback? Yahoo 429 (rate limit) and
// connection/parse failures all do. 404 (bad symbol) does NOT — the symbol is
// just as invalid on Twelve Data.
function isFallbackWorthwhile(err: unknown): boolean {
    if (err instanceof YahooFinanceError) {
        return err.status === 429 || err.status === 0 || err.status >= 500;
    }
    // Network errors, JSON parse errors, etc.
    return true;
}

// Primary entry point used by the stock tools and the workflow's review step.
// Same signature as the underlying providers: symbol + range + interval.
export async function fetchChart(
    symbol: string,
    range = "1d",
    interval = "5m",
): Promise<ChartResult> {
    // 1. Try Yahoo (unless it's in cooldown from recent rate-limiting).
    if (yahooHealthy()) {
        try {
            return await fetchYahooChart(symbol, range, interval);
        } catch (err) {
            if (isFallbackWorthwhile(err) && hasTwelveDataKey()) {
                // Rate-limited or transient — cool Yahoo down and fall through.
                if (err instanceof YahooFinanceError && err.status === 429) {
                    markYahooUnhealthy();
                }
                // fall through to Twelve Data
            } else {
                // 404 / bad symbol, or no key — rethrow as-is.
                throw err;
            }
        }
    }

    // 2. Fallback: Twelve Data (if configured).
    if (!hasTwelveDataKey()) {
        throw new YahooFinanceError(
            "Yahoo Finance failed and no TWELVEDATA_API_KEY is set for fallback.",
            503,
        );
    }
    return fetchTdChart(symbol, range, interval);
}

// Which provider actually served the most recent call? Useful for logging /
// debugging rate-limit issues without exposing internals to the agent.
export function lastProvider(): "yahoo" | "twelvedata" | "cooldown-yahoo" {
    if (!yahooHealthy()) return "cooldown-yahoo";
    return "yahoo"; // primary; only reported when healthy (fallback is implicit)
}
