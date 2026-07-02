// Shared Twelve Data client. Uses the official REST API (free tier, 800
// req/day). Reads TWELVEDATA_API_KEY from env. Acts as the fallback when
// Yahoo Finance rate-limits or fails.
//
// Docs: https://twelvedata.com/docs
//   /quote          -> real-time/delayed quote
//   /time_series    -> OHLCV candles (intraday + daily)

const BASE = "https://api.twelvedata.com";

export function getTwelveDataKey(): string {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) {
        throw new Error(
            "TWELVEDATA_API_KEY is not set. Add it to .env to enable the Twelve Data fallback.",
        );
    }
    return key;
}

export function hasTwelveDataKey(): boolean {
    return Boolean(process.env.TWELVEDATA_API_KEY);
}

export class TwelveDataError extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status: number, code: string | null = null) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

async function fetchJson<T>(path: string, retries = 1): Promise<T> {
    const key = getTwelveDataKey();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}apikey=${encodeURIComponent(key)}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { Accept: "application/json" },
            });
            if (res.status === 429 && attempt < retries) {
                await new Promise((r) => setTimeout(r, 1500));
                continue;
            }
            if (!res.ok) {
                throw new TwelveDataError(
                    `Twelve Data request failed (${res.status})`,
                    res.status,
                );
            }
            const data = (await res.json()) as any;
            // Twelve Data returns 200 with an error body on bad symbols / limits.
            if (data.status === "error") {
                throw new TwelveDataError(
                    data.message ?? "Twelve Data API error",
                    res.status,
                    data.code ?? null,
                );
            }
            return data as T;
        } catch (err) {
            lastErr = err;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, 800));
                continue;
            }
        }
    }
    throw lastErr instanceof Error
        ? lastErr
        : new TwelveDataError("Twelve Data request failed", 0);
}

// --- Types (reused from the Yahoo client shape for interchangeability) ----

export interface ChartMeta {
    currency?: string;
    symbol?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    regularMarketPrice?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    regularMarketTime?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    chartPreviousClose?: number;
    previousClose?: number;
}

export interface ChartResult {
    meta: ChartMeta;
    timestamps: number[];
    open: (number | null)[];
    high: (number | null)[];
    low: (number | null)[];
    close: (number | null)[];
    volume: (number | null)[];
}

interface QuoteResponse {
    symbol: string;
    name?: string;
    exchange?: string;
    currency?: string;
    datetime?: string;
    timestamp?: number;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
    previous_close?: string;
    change?: string;
    percent_change?: string;
    fifty_two_week?: { low?: string; high?: string };
    is_market_open?: boolean;
}

interface TimeSeriesResponse {
    meta: {
        symbol: string;
        interval?: string;
        currency?: string;
        exchange?: string;
        type?: string;
    };
    values: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume?: string;
    }>;
    status?: string;
    message?: string;
}

// --- Quote -> meta (mirrors Yahoo fetchChart meta shape) -----------------

export async function fetchQuoteMeta(
    symbol: string,
): Promise<ChartResult> {
    const q = await fetchJson<QuoteResponse>(
        `/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}`,
    );
    const last = Number(q.close);
    const prev = q.previous_close ? Number(q.previous_close) : undefined;
    const ts = q.timestamp
        ? q.timestamp
        : q.datetime
          ? Math.floor(new Date(q.datetime + (q.datetime.includes("T") ? "" : "T16:00:00")).getTime() / 1000)
          : Math.floor(Date.now() / 1000);
    return {
        meta: {
            symbol: q.symbol,
            exchangeName: q.exchange,
            fullExchangeName: q.name,
            currency: q.currency,
            regularMarketPrice: last,
            regularMarketDayHigh: q.high ? Number(q.high) : undefined,
            regularMarketDayLow: q.low ? Number(q.low) : undefined,
            regularMarketVolume: q.volume ? Number(q.volume) : undefined,
            regularMarketTime: ts,
            fiftyTwoWeekHigh: q.fifty_two_week?.high
                ? Number(q.fifty_two_week.high)
                : undefined,
            fiftyTwoWeekLow: q.fifty_two_week?.low
                ? Number(q.fifty_two_week.low)
                : undefined,
            previousClose: prev,
            chartPreviousClose: prev,
        },
        timestamps: [],
        open: [],
        high: [],
        low: [],
        close: [],
        volume: [],
    };
}

// --- Time series -> ChartResult ------------------------------------------
//
// Maps Twelve Data ranges+intervals to Yahoo-compatible params. Twelve Data
// uses `interval` (1min, 5min, 15min, 30min, 45min, 1h, 1day, 1week, 1month)
// and `outputsize` (number of candles). We translate the Yahoo `range` into
// a candle count + interval so callers stay provider-agnostic.

function rangeToOutputSize(range: string, tdInterval: string): number {
    // Trading-day approximation: ~78 5-min candles/day, ~6.5h sessions.
    const isIntraday = tdInterval.includes("min") || tdInterval === "1h";
    switch (range) {
        case "1d":
            return isIntraday ? 78 : 1;
        case "5d":
            return isIntraday ? 78 * 5 : 5;
        case "1mo":
            return 22;
        case "3mo":
            return 66;
        case "6mo":
            return 130;
        case "1y":
            return 252;
        case "2y":
            return 504;
        case "5y":
            return 260;
        case "ytd":
            // ~1.5 candles per trading day since Jan 1.
            return Math.max(22, Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) * (isIntraday ? 1.5 : 1));
        default:
            return 78; // "max" or unknown — keep it bounded to save quota.
    }
}

// Normalize Yahoo interval -> Twelve Data interval.
function yahooIntervalToTd(interval: string): string {
    switch (interval) {
        case "1m":
            return "1min";
        case "5m":
            return "5min";
        case "15m":
            return "15min";
        case "1h":
            return "1h";
        case "1d":
            return "1day";
        case "1wk":
            return "1week";
        case "1mo":
            return "1month";
        default:
            return interval;
    }
}

export async function fetchTimeSeries(
    symbol: string,
    range = "1d",
    interval = "5m",
): Promise<ChartResult> {
    const tdInterval = yahooIntervalToTd(interval);
    const outputsize = rangeToOutputSize(range, tdInterval);
    const data = await fetchJson<TimeSeriesResponse>(
        `/time_series?symbol=${encodeURIComponent(
            symbol.toUpperCase(),
        )}&interval=${tdInterval}&outputsize=${outputsize}&timezone=UTC`,
    );
    // Time series returns newest-first; we want oldest-first to match Yahoo.
    const candles = [...(data.values ?? [])].reverse();
    return {
        meta: {
            symbol: data.meta?.symbol ?? symbol.toUpperCase(),
            exchangeName: data.meta?.exchange,
            currency: data.meta?.currency,
        },
        timestamps: candles.map((c) =>
            Math.floor(new Date(c.datetime + "Z").getTime() / 1000),
        ),
        open: candles.map((c) => Number(c.open)),
        high: candles.map((c) => Number(c.high)),
        low: candles.map((c) => Number(c.low)),
        close: candles.map((c) => Number(c.close)),
        volume: candles.map((c) => (c.volume ? Number(c.volume) : null)),
    };
}

// Combined fetch: intraday candles (1d range) when available, else quote-only.
// Mirrors the Yahoo fetchChart contract so the unified client can swap freely.
export async function fetchChart(
    symbol: string,
    range = "1d",
    interval = "5m",
): Promise<ChartResult> {
    // For intraday ranges we need candles; otherwise a quote suffices for meta.
    if (range === "1d" || range === "5d") {
        const series = await fetchTimeSeries(symbol, range, interval);
        if (series.close.length > 0) {
            // Enrich meta with the latest close + previous close via a quote
            // only if the series lacks a regularMarketPrice (saves quota).
            const last = series.close[series.close.length - 1];
            return {
                ...series,
                meta: {
                    ...series.meta,
                    regularMarketPrice: last,
                    regularMarketDayHigh: Math.max(
                        ...series.high.filter((h): h is number => h != null),
                    ),
                    regularMarketDayLow: Math.min(
                        ...series.low.filter((l): l is number => l != null),
                    ),
                    regularMarketVolume: series.volume.reduce(
                        (acc, v) => acc + (v ?? 0),
                        0,
                    ),
                },
            };
        }
    }
    return fetchQuoteMeta(symbol);
}
