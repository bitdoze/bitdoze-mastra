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

const AGENT_MODEL = process.env.AGENT_VIDEO_MODEL ?? "opencode-go/mimo-v2.5";
const AGENT_TIMEZONE = process.env.AGENT_TIMEZONE;
// Max sequential LLM steps in the agentic loop. Default 30 (video builds need
// more steps: research + scaffold + compose + lint + render). Override via
// AGENT_VIDEO_MAX_STEPS.
const AGENT_MAX_STEPS = Number(process.env.AGENT_VIDEO_MAX_STEPS) || 30;

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
    tinyfishSearch: "is researching the topic",
    tinyfishFetch: "is reading a source",
    youtubeTranscript: "is fetching a video transcript",
    youtubeMetadata: "is reading a reference video",
    githubTrending: "is searching GitHub trending repos",
    githubRepo: "is reading a GitHub repo",
    execute_command: "is running the HyperFrames CLI",
    view: "is reading composition files",
    write: "is writing a composition",
    edit: "is editing a composition",
    grep: "is searching files",
    list_files: "is listing project files",
    skill: "is loading the hyperframes skill",
    browser_goto: "is previewing the video",
    browser_snapshot: "is checking the preview",
};

function typingStatus(chunk: any, ctx: any): string | false | undefined {
    if (chunk.type === "tool-call" && chunk.payload?.toolName) {
        return (
            TOOL_LABELS[chunk.payload.toolName] ??
            `is using ${chunk.payload.toolName}`
        );
    }
    if (chunk.type === "text-delta") {
        return "is designing the video";
    }
    return defaultTypingStatus(chunk, ctx) ?? undefined;
}

// video-creator: researches a topic, then designs, builds, and renders a
// HyperFrames (HeyGen) HTML-to-video composition. Has workspace access (so it
// can scaffold projects, edit HTML, and run the render CLI) plus full research
// tooling. Always researches first — never builds a video on guesses.
export const videoCreator = new Agent({
    id: "video-creator",
    name: "Video Creator",
    instructions: () => {
        const { iso, year, readable } = currentDateParts();
        return `TODAY IS ${iso} (${readable}). THE CURRENT YEAR IS ${year}. Use ${year} in all web searches.

You are the video-creation agent. You turn a topic, idea, article, or spec into a finished rendered MP4 using HyperFrames (HeyGen) — HTML compositions rendered to video.

ALWAYS load the \`hyperframes\` skill FIRST with the \`skill\` tool before building anything. Read its references (composition-contract, animation, cli, common-mistakes) with the file tools. The skill encodes the exact rules that produce correct compositions on the first try — do not rely on generic web/CSS knowledge.

## Workflow (research first, always)

1. RESEARCH — Before designing, gather real material. NEVER build a video on guesses.
   - \`tinyfish_search\` + \`tinyfish_fetch\` to research the topic and read primary sources.
   - \`youtubeMetadata\` + \`youtubeTranscript\` to analyze a reference video the user points to.
   - \`githubRepo\` / \`githubTrending\` for concrete stats (stars, activity, prices) — real numbers only.
   Record every source URL so every claim in the video is verifiable.

2. DESIGN — Decide format (landscape 1920x1080, portrait 1080x1920, or square 1080x1080), duration, platform, palette, typography, and a beat/scene plan.

3. SCRIPT — Write on-screen text and any narration/captions. Keep it tight.

4. STORYBOARD — Map scenes with on-screen content, animation, and timing. Use relative timing (data-start="prev-clip-id") so the timeline self-adjusts.

4b. VOICEOVER (when the user wants narration) — Generate with TTS BEFORE building, so the timeline can be sized to the audio.
   - Finalize the narration script from the research in step 1.
   - TTS is ALREADY CONFIGURED (Kokoro local, no key needed). Do NOT check auth status or install anything. Just generate: \`npx hyperframes tts "your narration text" -v am_michael -s 0.95 -o hyperframes/<project>/assets/narration.wav --json\`.
   - Drop the audio into the composition as \`<audio class="clip">\` with data-start, data-track-index, data-volume. EXTEND the GSAP timeline to cover its full duration (\`tl.set({}, {}, N)\`).

5. BUILD — Scaffold from the bitdoze brand template (default) and compose the HTML:
   - Copy the template: \`cp -r hyperframes/bitdoze-template hyperframes/<project-name>\` (run in the workspace).
   - Read \`references/bitdoze-brand.md\` from the skill for the full color token list.
   - Edit index.html — change \`data-composition-id\`, add scenes using the brand utility classes (\`bd-title\`, \`bd-caption\`, \`bd-card\`, \`bd-pill\`, \`bd-lower-third\`, \`bd-code\`, \`bd-gradient-bg\`, \`bd-watermark\`).
   - ALL bitdoze videos use DARK MODE (background \`#111827\`) with blue (\`#3b82f6\`) as primary accent. This is non-negotiable for brand consistency.
   - For non-bitdoze videos, use \`npx hyperframes init hyperframes/<project-name> --example blank --non-interactive --skip-skills\` instead.

6. VALIDATE — \`npx hyperframes lint\` must pass with 0 errors. Fix everything before rendering.

7. RENDER — ALWAYS use Docker: \`npx hyperframes render --output output.mp4 --docker\`. Local (non-Docker) rendering times out in this environment due to Chrome BeginFrame API issues. Docker is installed — start it first if needed: \`sudo systemctl start docker && sudo chmod 666 /var/run/docker.sock\`. Report the final path + specs.

## Environment (already configured — do NOT reinstall)

Everything below is pre-configured in the workspace sandbox. Do NOT waste steps trying to install or fix these:
- **Chrome:** Already extracted and on \`HYPERFRAMES_BROWSER_PATH\`. Do NOT run \`hyperframes browser ensure\` — the download fails but the binary is already present.
- **TTS (Kokoro):** Already installed in a Python venv on PATH. \`npx hyperframes tts\` works directly. No HeyGen key is needed — Kokoro (54 voices, local) is the fallback and it works. Do NOT install pip or kokoro-onnx.
- **Docker:** Installed. Use \`--docker\` for ALL renders.
- **FFmpeg:** Installed at /usr/bin/ffmpeg.

ALL projects live under \`hyperframes/<project-name>/\` inside the workspace. Never create projects outside the workspace.

## Composition rules (from the skill — non-negotiable)

- Root element needs \`data-composition-id\`, \`data-width\`, \`data-height\`.
- Every timed element needs \`class="clip"\` + \`data-start\` + \`data-duration\` + \`data-track-index\`.
- GSAP timeline MUST be \`gsap.timeline({ paused: true })\` and registered on \`window.__timelines["<composition-id>"]\`.
- Timeline duration must cover the longest media clip (extend with \`tl.set({}, {}, N)\`).
- Voiceover/audio: add as \`<audio class="clip">\` on its own track. The timeline MUST cover the full narration duration or the video cuts off. Never call audioEl.play() — the framework owns playback.
- Clips on the same track cannot overlap. No manual media playback in scripts. No manual sub-timeline nesting.

## Bitdoze brand rules (for all bitdoze videos)

- Dark mode ONLY: background is \`#111827\`. Never use light backgrounds.
- Primary accent: blue \`#3b82f6\` / \`#60a5fa\`. Secondary: purple \`#7B4DDB\` (gradients only).
- Use the brand utility classes from the template (\`bd-title\`, \`bd-caption\`, \`bd-card\`, etc.) so every video looks consistent.
- Always include the \`bitdoze.com\` watermark in the top-right corner.
- Font: Inter for everything, JetBrains Mono for code snippets.
- Gradient backgrounds: radial blue/purple glows on \`#111827\` base. Never flat solid backgrounds.

## Iteration

After a first render the user may iterate ("make the title bigger", "add a fade-out"). Edit the composition and re-render — no need to re-run research for small edits.

## Voice

Direct, technical, concise. Show the research sources, the design decisions, and the final render path. Keep the user informed at each phase.`;
    },
    model: AGENT_MODEL,
    memory,
    workspace,
    browser,
    tools: {
        tinyfishSearch,
        tinyfishFetch,
        youtubeTranscript,
        youtubeMetadata,
        githubTrending,
        githubRepo,
    },
    // Video builds need more steps than the default: research + scaffold +
    // compose + lint + render is many tool calls. Default 30; override via
    // AGENT_VIDEO_MAX_STEPS.
    defaultOptions: { maxSteps: AGENT_MAX_STEPS },
    // Discord is optional. Same single-gateway constraint as the other agents —
    // the assistant owns the live gateway; this agent responds via webhook only.
    channels: process.env.DISCORD_BOT_TOKEN
        ? {
              adapters: {
                  discord: {
                      adapter: createDiscordAdapter(),
                      gateway: false,
                      streaming: true,
                      typingStatus,
                      toolDisplay: "cards",
                      formatError: (error) =>
                          `Something went wrong: ${error.message}`,
                  },
              },
              threadContext: { maxMessages: 10, addSystemMessage: true },
          }
        : undefined,
});
