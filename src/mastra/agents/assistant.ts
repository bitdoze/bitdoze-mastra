import { Agent } from "@mastra/core/agent";
import { defaultTypingStatus } from "@mastra/core/channels";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { memory } from "../memory";
import { workspace } from "../workspaces";
import { browser } from "../browsers";
import { tinyfishSearch } from "../tools/tinyfish-search";
import { tinyfishFetch } from "../tools/tinyfish-fetch";
import { youtubeTranscript } from "../tools/youtube-transcript-tool";
import { youtubeMetadata } from "../tools/youtube-metadata-tool";
import { githubTrending } from "../tools/github-trending-tool";
import { githubRepo } from "../tools/github-repo-tool";
import { discordNotify } from "../tools/discord-notify";
import { queryDatabase } from "../tools/query-database";
import { postTweet } from "../tools/x-post";

const AGENT_MODEL = process.env.AGENT_MODEL ?? "opencode-go/glm-5.2";
const AGENT_JUDGE_MODEL = process.env.AGENT_JUDGE_MODEL ?? "opencode-go/glm-5.1";
// Optional IANA timezone (e.g. "Europe/Bucharest"). Defaults to the host timezone.
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE;
// Max sequential LLM steps in the agentic loop (each step = response + tool calls).
// Default 20; override via AGENT_MAX_STEPS. Applies to every generate/stream call
// (Studio, Discord, workflows) via defaultOptions.
const AGENT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS) || 20;

// Current date/time, formatted for the system prompt. Called on each
// generate/stream so the value is always fresh (no stale hardcoded date).
function currentDateParts(): { iso: string; year: string; readable: string } {
  const now = new Date();
  const iso = now.toISOString().split("T")[0]; // e.g. 2026-06-22
  const year = String(now.getUTCFullYear());
  const readable = new Intl.DateTimeFormat("en-US", {
    ...(AGENT_TIMEZONE ? { timeZone: AGENT_TIMEZONE } : {}),
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  return { iso, year, readable };
}

// Maps tool names to human-readable labels for Discord typing status.
const TOOL_LABELS: Record<string, string> = {
    tinyfishSearch: "is searching the web",
    tinyfishFetch: "is reading a web page",
    youtubeTranscript: "is fetching a video transcript",
    youtubeMetadata: "is reading video details",
    githubTrending: "is searching GitHub trending repos",
    githubRepo: "is reading a GitHub repo",
    discordNotify: "is sending a notification",
    queryDatabase: "is querying the database",
    postTweet: "is posting to X",
    browser_goto: "is opening a website",
    browser_snapshot: "is reading the page",
    browser_click: "is clicking a button",
    browser_type: "is filling in a form",
    browser_scroll: "is scrolling the page",
    browser_screenshot: "is taking a screenshot",
    browser_evaluate: "is running browser JS",
    execute_command: "is running a command",
    view: "is reading a file",
    write: "is writing a file",
    edit: "is editing a file",
    grep: "is searching files",
    list_files: "is listing files",
};

function typingStatus(chunk: any, ctx: any): string | false | undefined {
    if (chunk.type === "tool-call" && chunk.payload?.toolName) {
        return TOOL_LABELS[chunk.payload.toolName] ?? `is using ${chunk.payload.toolName}`;
    }
    if (chunk.type === "text-delta") {
        return "is thinking";
    }
    return defaultTypingStatus(chunk, ctx) ?? undefined;
}

// General-purpose assistant: files, shell, memory, live-web tools, and browser.
export const assistant = new Agent({
  id: "assistant",
  name: "Assistant",
  // Dynamic instructions: resolved on every call so the current date/time is
  // always accurate in the system prompt.
  instructions: () => {
    const { iso, year, readable } = currentDateParts();
    return `TODAY IS ${iso} (${readable}). THE CURRENT YEAR IS ${year}. Use ${year} in all web searches, never ${String(Number(year) - 1)} or any year from your training data.

You are a general-purpose coding and research assistant.

You can:
- Read, write, edit, and search files in the workspace.
- Execute shell commands to run tests, builds, and scripts. Commands require user approval.
- Search the live web with \`tinyfish_search\` and read full pages with \`tinyfish_fetch\`. For research tasks, use the research skill (search first, then fetch the best results).
- Get YouTube video metadata with \`fetch-youtube-metadata\` and transcripts/captions with \`fetch-youtube-transcript\`. Fetch metadata first for context, then the transcript to answer questions about a video's content.
- Discover trending GitHub repositories with \`github_trending_repos\` (new repos with lots of stars) and read a repo's full details and README with \`github_repo\`.
- Navigate websites with browser tools: go to a URL, take a snapshot of the page, click elements, type text, scroll, and extract structured data. Use the browser when a page needs JavaScript rendering or interactive navigation.

Guidelines:
- Always read a file before editing it.
- Run shell commands only when needed.
- Keep responses concise and focused on the task.
- Prefer doing real work with tools over guessing. Cite URLs when answering from the web.`;
  },
  model: AGENT_MODEL,
  memory,
  workspace,
  browser,
  goal: {
    judge: AGENT_JUDGE_MODEL,
    maxRuns: 50,
  },
  tools: { tinyfishSearch, tinyfishFetch, youtubeTranscript, youtubeMetadata, githubTrending, githubRepo, discordNotify, queryDatabase, postTweet },
  // Default execution options applied to every generate/stream call (Studio,
  // Discord, workflows). maxSteps sets the agentic loop budget.
  defaultOptions: { maxSteps: AGENT_MAX_STEPS },
  // Discord is an optional channel: only attach when a bot token is configured.
  // Without this guard, createDiscordAdapter() throws at module load and the
  // entire agent (files, shell, web, browser) becomes unusable.
  channels: process.env.DISCORD_BOT_TOKEN
    ? {
        adapters: {
          discord: {
            adapter: createDiscordAdapter(),
            // Stream agent text deltas to Discord (post then edit as it generates)
            streaming: true,
            // Custom typing status: "is searching the web", "is reading a file", etc.
            typingStatus,
            // Built-in cards mode: renders tool calls as Discord embeds (clean, no raw JSON)
            toolDisplay: "cards",
            // User-friendly error messages instead of raw stack traces
            formatError: (error) => `Something went wrong: ${error.message}`,
          },
        },
        // glm-5.2 has no vision support; skip inlineMedia to avoid 400 errors
        // on image input. Enable if a vision-capable model is configured.
        // inlineMedia: ["image/png", "image/jpeg", "image/webp"],
        // On first mention in a thread, fetch last 10 messages for context
        threadContext: { maxMessages: 10, addSystemMessage: true },
      }
    : undefined,
});
