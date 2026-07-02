// Shared Yahoo Finance client. Uses Yahoo's PUBLIC (no-key) HTTP endpoints:
//   - /v8/finance/chart/{symbol}     -> quote + OHLCV candles
//   - /v1/finance/search             -> symbol lookup
//   - /v1/finance/trending/{region}  -> trending tickers
//
// These endpoints are unofficial and require a realistic User-Agent header to
// avoid 403/429. They occasionally rate-limit; callers retry once on failure.

const BASE = "https://query1.finance.yahoo.com";
const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class YahooFinanceError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

async function fetchJson<T>(url: string, retries = 1): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": UA,
                    Accept: "application/json",
                },
            });
            if (res.status === 429 && attempt < retries) {
                await new Promise((r) => setTimeout(r, 1200));
                continue;
            }
            if (!res.ok) {
                throw new YahooFinanceError(
                    `Yahoo Finance request failed (${res.status})`,
                    res.status,
                );
            }
            return (await res.json()) as T;
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
        : new YahooFinanceError("Yahoo Finance request failed", 0);
}

// --- Types for the /v8/finance/chart response ----------------------------

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

export interface ChartResponse {
    chart: {
        result?: Array<any>;
        error?: { code: string; description: string };
    };
}

export async function fetchChart(
    symbol: string,
    range = "1d",
    interval = "5m",
): Promise<ChartResult> {
    const url = `${BASE}/v8/finance/chart/${encodeURIComponent(
        symbol.toUpperCase(),
    )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(
        interval,
    )}&includePrePost=false`;
    const data = await fetchJson<ChartResponse>(url);
    const r = data.chart?.result?.[0];
    if (!r) {
        throw new YahooFinanceError(
            data.chart?.error?.description ?? `No chart data for ${symbol}`,
            404,
        );
    }
    const q = r.indicators?.quote?.[0] ?? {};
    return {
        meta: r.meta ?? {},
        timestamps: r.timestamp ?? [],
        open: q.open ?? [],
        high: q.high ?? [],
        low: q.low ?? [],
        close: q.close ?? [],
        volume: q.volume ?? [],
    };
}

// --- Types for /v1/finance/search ----------------------------------------

export interface SearchQuote {
    symbol: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    quoteType?: string;
    sector?: string;
    industry?: string;
}

export interface SearchResponse {
    quotes?: SearchQuote[];
}

export async function fetchSearch(query: string, count = 8): Promise<SearchQuote[]> {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(
        query,
    )}&quotesCount=${count}&newsCount=0`;
    const data = await fetchJson<SearchResponse>(url);
    return data.quotes ?? [];
}

// --- Types for /v1/finance/trending --------------------------------------

export interface TrendingQuote {
    symbol: string;
}

export interface TrendingResponse {
    finance?: { result?: Array<{ quotes?: TrendingQuote[] }> };
}

export async function fetchTrending(region = "US"): Promise<string[]> {
    const url = `${BASE}/v1/finance/trending/${encodeURIComponent(
        region,
    )}?count=20`;
    const data = await fetchJson<TrendingResponse>(url);
    return (
        data.finance?.result?.[0]?.quotes?.map((q) => q.symbol) ?? []
    );
}
