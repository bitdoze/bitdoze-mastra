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

const AGENT_MODEL = process.env.AGENT_MODEL ?? "opencode-go/glm-5.2";
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE;
// Max sequential LLM steps in the agentic loop. Default 20; override via AGENT_MAX_STEPS.
const AGENT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS) || 20;

function currentDateParts(): { iso: string; year: string; readable: string } {
  const now = new Date();
  const iso = now.toISOString().split("T")[0];
  const year = String(now.getUTCFullYear());
  const readable = new Intl.DateTimeFormat("en-US", {
    ...(AGENT_TIMEZONE ? { timeZone: AGENT_TIMEZONE } : {}),
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  return { iso, year, readable };
}

const TOOL_LABELS: Record<string, string> = {
    tinyfishSearch: "is searching the web",
    tinyfishFetch: "is reading a web page",
    youtubeTranscript: "is fetching a video transcript",
    youtubeMetadata: "is reading video details",
    githubTrending: "is searching GitHub trending repos",
    githubRepo: "is reading a GitHub repo",
    browser_goto: "is opening a website",
    browser_snapshot: "is reading the page",
    browser_click: "is clicking a button",
    execute_command: "is running a command",
    view: "is reading a file",
    write: "is writing a file",
    edit: "is editing a file",
    skill: "is loading a skill",
};

function typingStatus(chunk: any, ctx: any): string | false | undefined {
    if (chunk.type === "tool-call" && chunk.payload?.toolName) {
        return TOOL_LABELS[chunk.payload.toolName] ?? `is using ${chunk.payload.toolName}`;
    }
    if (chunk.type === "text-delta") {
        return "is writing";
    }
    return defaultTypingStatus(chunk, ctx) ?? undefined;
}

// youtube-master: a dedicated agent for webdoze video planning and scriptwriting.
// Has access to every tool (web search/fetch, YouTube, GitHub, browser, files,
// shell) and the webdoze-scriptwriting skill. Helps turn a bitdoze article,
// spec, or topic into a full unscripted-video plan.
export const youtubeMaster = new Agent({
  id: "youtube-master",
  name: "YouTube Master",
  instructions: () => {
    const { iso, year, readable } = currentDateParts();
    return `TODAY IS ${iso} (${readable}). THE CURRENT YEAR IS ${year}. Use ${year} in all web searches.

You are the webdoze video-planning agent. Your job is to help the user turn a bitdoze.com article, a topic, or a raw idea into a complete plan for a webdoze YouTube video.

The webdoze channel covers: AI tools, local AI, self-hosting, developer tools, Mac setup, Bunny.net/CDN/VPS. The audience is cost-conscious developers. The creator films UNSCRIPTED, straight to camera — so you produce a PLAN, never a full word-for-word script.

ALWAYS follow the \`webdoze-scriptwriting\` skill. Load it now with the \`skill\` tool ("webdoze-scriptwriting") and read its references before producing any plan. The skill defines the exact 6-section plan format (hook, sticky note, money moments, section-by-screen breakdown, retention killers, title options) and the channel context, retention rules, and CTR-proven title patterns.

You have full tool access — use it to do real research, not guess:
- \`tinyfish_search\` + \`tinyfish_fetch\` to research a topic or read a bitdoze article.
- \`fetch-youtube-metadata\` (+ \`fetch-youtube-transcript\` if available) to analyze an existing video.
- \`github_trending_repos\` + \`github_repo\` to understand a tool/library and get concrete stats (stars, activity) for money moments.
- Browser and file tools when needed.

Every money moment must be backed by a real, verifiable fact you fetched — a price, a benchmark, a star count, a line from the README. Never invent numbers.

VOICE: write in the normal webdoze creator voice — direct, technical, plain-spoken, opinionated, no hype words. The Ce-ne-eneerveaza satirical voice (in the skill references) is OPTIONAL and must ONLY be used when the user explicitly asks for it ("satirical", "satira", "Ce ne enerveaza voice", "Mihai Radu style", "angry version"). Never use it unprompted.

When you produce a plan, save it to the workspace as \`video-plans/<slug>.md\` and also show it inline. Offer 2–3 title options and flag the single best one.`;
  },
  model: AGENT_MODEL,
  memory,
  workspace,
  tools: {
    tinyfishSearch,
    tinyfishFetch,
    youtubeTranscript,
    youtubeMetadata,
    githubTrending,
    githubRepo,
  },
  // Default execution options applied to every generate/stream call.
  defaultOptions: { maxSteps: AGENT_MAX_STEPS },
  channels: process.env.DISCORD_BOT_TOKEN
    ? {
        adapters: {
          discord: {
            adapter: createDiscordAdapter(),
            // Only ONE agent may own the live Discord Gateway connection per
            // bot token (Discord allows a single gateway session). The
            // assistant agent holds it; this agent responds via webhook only.
            // Without this, two gateway listeners fight over the session and
            // the bot appears offline/grey in Discord.
            gateway: false,
            streaming: true,
            typingStatus,
            toolDisplay: "cards",
            formatError: (error) => `Something went wrong: ${error.message}`,
          },
        },
        threadContext: { maxMessages: 10, addSystemMessage: true },
      }
    : undefined,
});
