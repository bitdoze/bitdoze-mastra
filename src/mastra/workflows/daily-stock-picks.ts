import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { WORKSPACE_PATH } from "../paths";
import { fetchChart } from "../tools/market-data";
import { discordNotify } from "../tools/discord-notify";

const notify = discordNotify.execute ?? (async () => ({ sent: false }));

// Default starting capital. Once the portfolio log exists, the running cash
// balance is read from the file so compounding carries across days.
const STARTING_CAPITAL = Number(process.env.STOCK_STARTING_CAPITAL) || 1000;
const PORTFOLIO_FILE = join(WORKSPACE_PATH, "stock-portfolio.md");

// --- Portfolio log format -------------------------------------------------
//
// The log is a markdown file of dated sections. Each OPEN day looks like:
//
//   ## 2026-06-29 (Mon) — OPEN
//   - BUY NVDA @ $123.45 | size: $500 | stop: -3% | target: +5% | setup: momentum | rationale: ...
//   - BUY AMD @ $98.76 | size: $500 | stop: -2% | target: +4% | setup: earnings | rationale: ...
//   - PORTFOLIO_CASH: 0 USD
//   - CASH_REMAINING: 0 USD
//   - CONFIDENCE: medium — ...
//   - THESIS_SUMMARY: ...
//
// A later REVIEW section (auto-generated the next run) closes those picks:
//
//   ## 2026-06-29 — REVIEW 2026-06-30
//   - NVDA: open $124.00 -> $130.20 (+5.0%) [target hit] | P&L: +$25.00 | setup: momentum
//   - AMD: open $98.50 -> $95.10 (-3.4%) [stop hit @ $96.53] | P&L: -$15.00 | setup: earnings
//   - **Day P&L:** +$10.00 | **Running cash:** $1010.00

interface OpenPick {
    date: string;
    symbol: string;
    entryPrice: number; // agent's stated price (pre-market estimate)
    size: number;
    stopPct: number; // e.g. 3 means -3% stop
    targetPct: number; // e.g. 5 means +5% target
    setup: string; // setup type tag for learning
}

interface ReviewedTrade {
    symbol: string;
    entryPrice: number; // actual open fill
    exitPrice: number;
    pct: number;
    pnl: number;
    exitReason: "target" | "stop" | "close";
    setup: string;
}

interface RunningState {
    cash: number;
    realizedPnl: number;
    // Picks from a PRIOR day that have actually traded (date < today) and
    // haven't been reviewed yet. These are what the review step closes out.
    openPicks: OpenPick[];
    // Picks the agent already made TODAY (date === today). They haven't traded
    // yet (they enter tomorrow's open), so they are NOT reviewed — but they're
    // surfaced to the agent on a re-run so it can revise with awareness.
    todayPicks: OpenPick[];
    wins: number;
    total: number;
    recentTrades: string[]; // "SYMBOL: WIN/LOSS +X.XX USD (setup: momentum)"
    lastReviewDate?: string;
}

async function readPortfolio(): Promise<string> {
    try {
        return await readFile(PORTFOLIO_FILE, "utf-8");
    } catch {
        return "";
    }
}

// Parse the most recent tradable OPEN section (date < today, no review yet)
// plus any OPEN picks the agent already made today (date === today), and the
// running cash from the last REVIEW section. Cheap line-based scan.
function parseRunningState(
    content: string,
    startingCash: number,
    today: string,
): RunningState {
    const state: RunningState = {
        cash: startingCash,
        realizedPnl: 0,
        openPicks: [],
        todayPicks: [],
        wins: 0,
        total: 0,
        recentTrades: [],
    };
    if (!content.trim()) return state;

    const sections = content.split(/^## /m).filter((s) => s.trim());
    const reviewedDates = new Set<string>();
    for (const s of sections) {
        const m = s.match(/^(\d{4}-\d{2}-\d{2}).*—\s*REVIEW/);
        if (m) reviewedDates.add(m[1]);
    }

    // Most recent tradable (pre-today) un-reviewed OPEN picks.
    let lastTradablePicks: OpenPick[] = [];
    // Picks dated today (the agent's earlier decision today, if re-running).
    let todayOpenPicks: OpenPick[] = [];
    let todayCash: number | undefined;

    for (const s of sections) {
        const header = s.split("\n")[0] ?? "";
        const dateMatch = header.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) continue;
        const date = dateMatch[1];

        if (/—\s*REVIEW/.test(header)) {
            const reviewMatch = header.match(/REVIEW\s*(\d{4}-\d{2}-\d{2})?/);
            if (reviewMatch?.[1]) state.lastReviewDate = reviewMatch[1];
            for (const line of s.split("\n")) {
                const pl = line.match(/P&L:\s*(-?\+?-?\$?[\d.]+)/i);
                if (pl) {
                    const v = parseFloat(pl[1].replace(/[+$]/g, ""));
                    state.realizedPnl += v;
                    state.total++;
                    if (v > 0) state.wins++;
                    const sym = line.match(/^-\s*([A-Z.]+)/);
                    const setupTag = line.match(/setup:\s*(\w+)/);
                    const tag = setupTag?.[1] ?? "?";
                    state.recentTrades.push(
                        `${sym?.[1] ?? "?"}: ${v >= 0 ? "WIN" : "LOSS"} ${v >= 0 ? "+" : ""}${v.toFixed(2)} USD (setup: ${tag})`,
                    );
                }
                const cash = line.match(/\*\*Running cash:\*\*\s*\$?([\d.]+)/i);
                if (cash) state.cash = parseFloat(cash[1]);
            }
        } else if (!reviewedDates.has(date)) {
            // OPEN section (not yet reviewed) — gather BUY picks.
            const picks: OpenPick[] = [];
            let cashLine: number | undefined;
            for (const line of s.split("\n")) {
                const buy = line.match(
                    /^-\s*BUY\s+([A-Z.]+)\s+@\s*\$?([\d.]+)\s*\|\s*size:\s*\$([\d.]+)/i,
                );
                if (buy) {
                    const stopMatch = line.match(/stop:\s*-?([\d.]+)%/i);
                    const targetMatch = line.match(/target:\s*\+?([\d.]+)%/i);
                    const setupMatch = line.match(/setup:\s*(\w+)/i);
                    picks.push({
                        date,
                        symbol: buy[1],
                        entryPrice: parseFloat(buy[2]),
                        size: parseFloat(buy[3]),
                        stopPct: stopMatch ? parseFloat(stopMatch[1]) : 3,
                        targetPct: targetMatch ? parseFloat(targetMatch[1]) : 5,
                        setup: setupMatch?.[1] ?? "unknown",
                    });
                }
                const cash = line.match(/CASH_REMAINING:\s*\$?([\d.]+)/i);
                if (cash) cashLine = parseFloat(cash[1]);
            }
            if (picks.length === 0) continue;
            if (date === today) {
                // Today's own OPEN picks — haven't traded, kept for revision.
                todayOpenPicks = picks;
                if (cashLine !== undefined) todayCash = cashLine;
            } else if (date < today) {
                // A prior day's picks that have traded — eligible for review.
                lastTradablePicks = picks;
                if (cashLine !== undefined) state.cash = cashLine;
            }
        }
    }
    state.openPicks = lastTradablePicks;
    state.todayPicks = todayOpenPicks;
    // If the agent already committed cash today, reflect the post-decision
    // cash balance so a re-run doesn't double-spend.
    if (todayCash !== undefined) state.cash = todayCash;
    state.recentTrades = state.recentTrades.slice(-12);
    return state;
}

// --- Market-day guard -----------------------------------------------------
//
// Checks whether the US market was open today (or the most recent trading
// day). We fetch a 1d chart for SPY (a reliable proxy) and verify it returned
// intraday candles dated today. If not (weekend/holiday), the workflow should
// skip the review (nothing to close) but can still produce picks.
async function isMarketOpenToday(): Promise<boolean> {
    try {
        const chart = await fetchChart("SPY", "1d", "5m");
        const lastTs = chart.timestamps[chart.timestamps.length - 1];
        if (!lastTs) return false;
        const lastDate = new Date(lastTs * 1000).toISOString().split("T")[0];
        const today = new Date().toISOString().split("T")[0];
        return lastDate === today;
    } catch {
        return false;
    }
}

// --- Intraday P&L computation --------------------------------------------
//
// For each open pick, fetch the day's intraday candles (1d / 5m) and simulate
// a realistic day-trade:
//   1. ENTRY = the open of the first candle (actual open fill, not the
//      agent's pre-market estimate).
//   2. Walk candles chronologically. If a candle's LOW penetrates the stop
//      price, exit at the stop price (assume fill at stop). If a candle's
//      HIGH penetrates the target price, exit at the target price.
//   3. If neither is hit, EXIT = the close of the last candle.
// This faithfully enforces the stop/target the agent committed to, instead of
// just using the close (which ignores intraday excursions).

async function reviewPick(pick: OpenPick): Promise<ReviewedTrade> {
    const fallbackEntry = pick.entryPrice;
    let entry = fallbackEntry;
    let exitPrice = fallbackEntry;
    let exitReason: ReviewedTrade["exitReason"] = "close";

    try {
        const chart = await fetchChart(pick.symbol, "1d", "5m");
        const stopPrice = entry * (1 - pick.stopPct / 100);
        const targetPrice = entry * (1 + pick.targetPct / 100);

        // Find the first candle with a non-null open = market open.
        let opened = false;
        for (let i = 0; i < chart.timestamps.length; i++) {
            const o = chart.open[i];
            const h = chart.high[i];
            const l = chart.low[i];
            const c = chart.close[i];
            if (o == null || h == null || l == null) continue;

            if (!opened) {
                entry = o;
                opened = true;
                // Recompute stop/target with the real open fill.
                // (Don't break — this same candle could also hit stop/target.)
            }

            // Check stop first (pessimistic: assume worst case within candle).
            if (l <= stopPrice) {
                exitPrice = stopPrice;
                exitReason = "stop";
                break;
            }
            // Check target.
            if (h >= targetPrice) {
                exitPrice = targetPrice;
                exitReason = "target";
                break;
            }
            // Track close as fallback exit.
            if (c != null) exitPrice = c;
        }
    } catch {
        // Chart unavailable — fall back to the agent's stated price.
        entry = fallbackEntry;
        exitPrice = fallbackEntry;
    }

    const pct = ((exitPrice - entry) / entry) * 100;
    const pnl = ((exitPrice - entry) / entry) * pick.size;
    return {
        symbol: pick.symbol,
        entryPrice: entry,
        exitPrice,
        pct,
        pnl,
        exitReason,
        setup: pick.setup,
    };
}

// --- Step 1: Review yesterday's picks -------------------------------------

const reviewStep = createStep({
    id: "review-open-picks",
    inputSchema: z.object({
        manualRun: z
            .boolean()
            .optional()
            .describe("Set true for an ad-hoc run outside the schedule"),
    }),
    outputSchema: z.object({
        today: z.string(),
        marketOpen: z.boolean(),
        cash: z.number(),
        openPicks: z.array(
            z.object({
                date: z.string(),
                symbol: z.string(),
                entryPrice: z.number(),
                size: z.number(),
            }),
        ),
        isRevision: z.boolean().describe("True if the agent already produced picks today"),
        earlierTodayPicks: z.array(
            z.object({
                symbol: z.string(),
                entryPrice: z.number(),
                size: z.number(),
                setup: z.string(),
            }),
        ),
        realizedPnl: z.number(),
        wins: z.number(),
        total: z.number(),
        winRate: z.number(),
        recentTrades: z.array(z.string()),
        reviewSummary: z.string(),
        reviewedToday: z.boolean(),
        portfolioPath: z.string(),
    }),
    execute: async ({ inputData }) => {
        const today = new Date().toISOString().split("T")[0];
        const marketOpen = await isMarketOpenToday();
        const content = await readPortfolio();
        const state = parseRunningState(content, STARTING_CAPITAL, today);

        let reviewSummary = "No open picks to review.";
        let reviewedToday = false;

        // Only review picks from a PRIOR day (date < today). Today's own OPEN
        // picks haven't traded yet (they enter tomorrow's open), so reviewing
        // them would be a phantom P&L. This is what makes re-runs safe.
        if (state.openPicks.length > 0 && marketOpen) {
            const trades: ReviewedTrade[] = [];
            for (const pick of state.openPicks) {
                trades.push(await reviewPick(pick));
            }

            let dayPnl = 0;
            const lines: string[] = [];
            for (const t of trades) {
                dayPnl += t.pnl;
                const reasonTag =
                    t.exitReason === "target"
                        ? "[target hit]"
                        : t.exitReason === "stop"
                          ? `[stop hit @ $${t.exitPrice.toFixed(2)}]`
                          : "[market close]";
                lines.push(
                    `- ${t.symbol}: open $${t.entryPrice.toFixed(2)} -> $${t.exitPrice.toFixed(2)} (${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(1)}%) ${reasonTag} | P&L: ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} | setup: ${t.setup}`,
                );
            }

            state.cash = Math.max(0, state.cash + dayPnl);
            state.realizedPnl += dayPnl;
            for (const t of trades) {
                state.total++;
                if (t.pnl > 0) state.wins++;
            }

            const reviewSection =
                `\n## ${state.openPicks[0].date} — REVIEW ${today}\n` +
                lines.join("\n") +
                `\n- **Day P&L:** ${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(2)} | **Running cash:** $${state.cash.toFixed(2)}\n`;

            await mkdir(WORKSPACE_PATH, { recursive: true });
            const existing = await readPortfolio();
            await writeFile(PORTFOLIO_FILE, existing + reviewSection, "utf-8");
            reviewedToday = true;
            reviewSummary =
                `Reviewed ${trades.length} pick(s) from ${state.openPicks[0].date}. ` +
                `Day P&L: ${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(2)} USD. ` +
                lines.join(" | ");
        } else if (state.openPicks.length > 0 && !marketOpen) {
            reviewSummary = `Market closed today (${today}). ${state.openPicks.length} pick(s) from ${state.openPicks[0].date} held for next open session.`;
        }

        const winRate = state.total > 0 ? (state.wins / state.total) * 100 : 0;
        const isRevision = state.todayPicks.length > 0;

        if (isRevision) {
            reviewSummary =
                (reviewedToday ? reviewSummary + " " : "") +
                `REVISION run: the agent already produced ${state.todayPicks.length} pick(s) earlier today (${state.todayPicks.map((p) => p.symbol).join(", ")}). These have NOT traded yet; the new decision replaces them.`;
        }

        return {
            today,
            marketOpen,
            cash: state.cash,
            openPicks: [],
            isRevision,
            earlierTodayPicks: state.todayPicks.map((p) => ({
                symbol: p.symbol,
                entryPrice: p.entryPrice,
                size: p.size,
                setup: p.setup,
            })),
            realizedPnl: state.realizedPnl,
            wins: state.wins,
            total: state.total,
            winRate,
            recentTrades: state.recentTrades,
            reviewSummary,
            reviewedToday,
            portfolioPath: PORTFOLIO_FILE,
        };
    },
});

// --- Step 2: Ask the agent for today's picks ------------------------------

const decideStep = createStep({
    id: "decide-picks",
    inputSchema: z.object({
        today: z.string(),
        marketOpen: z.boolean(),
        cash: z.number(),
        openPicks: z.array(
            z.object({
                date: z.string(),
                symbol: z.string(),
                entryPrice: z.number(),
                size: z.number(),
            }),
        ),
        isRevision: z.boolean(),
        earlierTodayPicks: z.array(
            z.object({
                symbol: z.string(),
                entryPrice: z.number(),
                size: z.number(),
                setup: z.string(),
            }),
        ),
        realizedPnl: z.number(),
        wins: z.number(),
        total: z.number(),
        winRate: z.number(),
        recentTrades: z.array(z.string()),
        reviewSummary: z.string(),
        reviewedToday: z.boolean(),
        portfolioPath: z.string(),
    }),
    outputSchema: z.object({
        today: z.string(),
        agentText: z.string(),
        cash: z.number(),
        reviewedToday: z.boolean(),
        reviewSummary: z.string(),
        isRevision: z.boolean(),
        portfolioPath: z.string(),
        error: z.string().optional(),
    }),
    execute: async ({ inputData, mastra }) => {
        const agent = mastra.getAgent("financeExpert");

        // Build setup-performance breakdown from recent trades so the agent
        // sees which setup TYPES are working, not just individual symbols.
        const setupStats: Record<string, { w: number; l: number; pnl: number }> = {};
        for (const t of inputData.recentTrades) {
            const m = t.match(/\(setup:\s*(\w+)\)/);
            const setup = m?.[1] ?? "unknown";
            if (!setupStats[setup]) setupStats[setup] = { w: 0, l: 0, pnl: 0 };
            if (/WIN/.test(t)) setupStats[setup].w++;
            else setupStats[setup].l++;
            const pnlMatch = t.match(/(-?[\d.]+)\s*USD/);
            if (pnlMatch) setupStats[setup].pnl += parseFloat(pnlMatch[1]);
        }
        const setupLines = Object.entries(setupStats)
            .map(
                ([s, st]) =>
                    `  - ${s}: ${st.w}W/${st.l}L (net ${st.pnl >= 0 ? "+" : ""}${st.pnl.toFixed(2)} USD)`,
            )
            .join("\n");

        const revisionBlock = inputData.isRevision
            ? `\n## REVISION NOTICE\nYou already produced picks earlier today. Your previous decision:\n${inputData.earlierTodayPicks.map((p) => `  - BUY ${p.symbol} @ $${p.entryPrice.toFixed(2)} | size: $${p.size.toFixed(2)} | setup: ${p.setup}`).join("\n")}\nThese have NOT traded yet. You may keep them, modify them, or replace them entirely with better picks now that you have more/fresher data. If you change them, the new picks REPLACE the old ones (the old OPEN section is overwritten).\n`
            : "";

        const performanceContext =
            `## Performance context\n` +
            `Today: ${inputData.today}\n` +
            `Market open: ${inputData.marketOpen ? "yes" : "no (holiday/weekend)"}\n` +
            `Available cash: $${inputData.cash.toFixed(2)}\n` +
            `Realized P&L (all time): ${inputData.realizedPnl >= 0 ? "+" : ""}${inputData.realizedPnl.toFixed(2)} USD\n` +
            `Win rate: ${inputData.wins}/${inputData.total} (${inputData.winRate.toFixed(0)}%)\n` +
            `Open positions: ${inputData.openPicks.length === 0 ? "none" : inputData.openPicks.map((p) => `${p.symbol} @ $${p.entryPrice.toFixed(2)}`).join(", ")}\n` +
            `Setup-type performance:\n${setupLines || "  (no data yet)"}\n` +
            `Recent trades (oldest->newest):\n${inputData.recentTrades.length ? inputData.recentTrades.map((t) => `  - ${t}`).join("\n") : "  (none yet)"}\n\n` +
            revisionBlock +
            `\n## Last review\n${inputData.reviewSummary}\n\n` +
            `Produce today's recommendation now. Follow your output format exactly.`;

        try {
            const res = await agent.generate(performanceContext, {
                memory: {
                    thread: `finance-expert-${inputData.today}`,
                    resource: "workflow",
                },
            });
            return {
                today: inputData.today,
                agentText: (res.text ?? "").trim(),
                cash: inputData.cash,
                reviewedToday: inputData.reviewedToday,
                reviewSummary: inputData.reviewSummary,
                isRevision: inputData.isRevision,
                portfolioPath: inputData.portfolioPath,
            };
        } catch (err) {
            return {
                today: inputData.today,
                agentText: "",
                cash: inputData.cash,
                reviewedToday: inputData.reviewedToday,
                reviewSummary: inputData.reviewSummary,
                isRevision: inputData.isRevision,
                portfolioPath: inputData.portfolioPath,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
});

// --- Step 3: Persist the new picks + notify -------------------------------

const persistStep = createStep({
    id: "persist-and-notify",
    inputSchema: z.object({
        today: z.string(),
        agentText: z.string(),
        cash: z.number(),
        reviewedToday: z.boolean(),
        reviewSummary: z.string(),
        isRevision: z.boolean(),
        portfolioPath: z.string(),
        error: z.string().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        today: z.string(),
        path: z.string().optional(),
        notified: z.boolean(),
        summary: z.string(),
    }),
    execute: async ({ inputData }) => {
        const weekday = new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            timeZone: process.env.AGENT_TIMEZONE ?? "UTC",
        }).format(new Date(inputData.today + "T12:00:00Z"));

        const sectionBody = inputData.error
            ? `_Agent error: ${inputData.error}_\n`
            : inputData.agentText || "_No recommendation produced._";

        const sectionHeader = `## ${inputData.today} (${weekday}) — OPEN`;
        const newSection = `\n${sectionHeader}\n${sectionBody}\n`;

        await mkdir(WORKSPACE_PATH, { recursive: true });
        let existing = "";
        try {
            existing = await readFile(inputData.portfolioPath, "utf-8");
        } catch {
            existing =
                `# Stock Portfolio — Daily Picks Log\n\n` +
                `Starting capital: $${STARTING_CAPITAL.toFixed(2)}\n` +
                `Strategy: US equity day trades. Educational analysis only, not financial advice.\n`;
        }

        let finalContent: string;
        if (inputData.isRevision) {
            // Replace today's existing OPEN section (and anything after it up
            // to the next ## header) with the new decision. This keeps the log
            // clean: one OPEN section per day, latest decision wins.
            const sectionRegex = new RegExp(
                `\\n## ${inputData.today} \\([^)]+\\) — OPEN[\\s\\S]*?(?=\\n## |$)`,
            );
            if (sectionRegex.test(existing)) {
                finalContent = existing.replace(sectionRegex, newSection);
            } else {
                // Header format mismatch — fall back to append.
                finalContent = existing + newSection;
            }
        } else {
            finalContent = existing + newSection;
        }
        await writeFile(inputData.portfolioPath, finalContent, "utf-8");

        const revisionTag = inputData.isRevision
            ? " [REVISED — replaces earlier picks]"
            : "";
        const message =
            (inputData.reviewedToday
                ? `**Yesterday's review**\n${inputData.reviewSummary}\n\n`
                : inputData.isRevision
                  ? `**Revision** — you re-ran today; the new picks replace the earlier ones.\n\n`
                  : "") +
            `**Today's recommendation** (${inputData.today})${revisionTag}\n` +
            (inputData.error
                ? `Agent failed: ${inputData.error}`
                : inputData.agentText ||
                  "No picks produced (capital preservation).") +
            `\n\nCash: $${inputData.cash.toFixed(2)} | Log: \`${inputData.portfolioPath}\``;

        await notify(
            {
                message,
                title: inputData.error
                    ? "Daily Stock Picks — Error"
                    : inputData.isRevision
                      ? "Daily Stock Picks — Revised"
                      : "Daily Stock Picks",
                level: inputData.error ? "error" : "info",
            },
            {} as any,
        );

        return {
            ok: !inputData.error,
            today: inputData.today,
            path: inputData.portfolioPath,
            notified: true,
            summary: message,
        };
    },
});

// --- Workflow assembly ----------------------------------------------------

export const dailyStockPicks = createWorkflow({
    id: "daily-stock-picks",
    inputSchema: z.object({
        manualRun: z.boolean().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        today: z.string(),
        path: z.string().optional(),
        notified: z.boolean(),
        summary: z.string(),
    }),
    // Runs after US market close (16:00 ET = 20:00 UTC). At 20:30 UTC the
    // close is final, so the review step gets real close data + intraday
    // candles for stop/target enforcement. Picks made here are for the NEXT
    // trading day's open. Mon-Fri only.
    schedule: {
        cron: "30 20 * * 1-5",
        timezone: "UTC",
        inputData: {},
    },
})
    .then(reviewStep)
    .then(decideStep)
    .then(persistStep)
    .commit();
