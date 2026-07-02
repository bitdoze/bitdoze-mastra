# Fable Plan — Review & Enhancement Recommendations for mastra-app

Review date: 2026-07-02. Reviewed against `@mastra/core` 1.48.0 (embedded docs verified for every API referenced below; sections 2-8 originally audited on 1.46.0).

## 1. What exists today (baseline)

A solid, well-commented personal agents platform:

- **6 agents**: `assistant` (general purpose, Discord gateway, goals), `youtube-master` (video planning), `video-creator` (HyperFrames video builds), `bitdoze-editor` + `bitdoze-judge` (article refresh pair), `finance-expert` (day-trading analyst).
- **3 scheduled workflows**: `daily-digest` (07:30), `bitdoze-article-update` (08:00/20:00, editor -> judge -> build -> git push), `daily-stock-picks` (post-close weekdays, review -> decide -> persist with stop/target simulation).
- **~20 tools**: TinyFish search/fetch, YouTube, GitHub, Discord notify, read-only SQL, X + Bluesky posting, MiniMax TTS, Yahoo Finance with Twelve Data fallback.
- **Infrastructure**: composite storage (LibSQL + DuckDB observability), memory (working memory + semantic recall via local fastembed), sandboxed workspace with skills + BM25, thread-scoped browser, SimpleAuth, observability with `SensitiveDataFilter`, Mastra Editor, custom objective REST routes.

Strengths worth keeping: dynamic date-aware instructions, single-Discord-gateway discipline, workflow-owned file writes (agents without file tools where it matters), editor/judge model separation, provider fallback layer, absolute path resolution.

The gaps: **zero tests, zero scorers (evals package installed but `scorers/` is empty), no typecheck/lint scripts, no CI**, a few real bugs, and several high-leverage Mastra features (guardrail processors, scorers, supervisor agents, RAG, MCP, observational memory) left unused.

---

## 2. Bugs and correctness fixes (do first)

### B1. `daily-stock-picks`: stop/target computed from the estimated entry, never recomputed at the real open
In `reviewPick()`, `stopPrice`/`targetPrice` are computed from the agent's pre-market estimate BEFORE the candle loop. The comment says "Recompute stop/target with the real open fill" but the code never does; after `entry = o` the loop keeps checking the stale prices. If the stock gaps overnight, stops/targets fire at the wrong levels (a gap-down can trigger an instant phantom "stop hit" on candle 1). Fix: recompute both prices when the first fill is found, then evaluate that same candle.

### B2. `daily-stock-picks`: cron `30 20 * * 1-5` UTC runs BEFORE the US close in winter
16:00 ET = 20:00 UTC only during EDT. During EST (Nov-Mar) the close is 21:00 UTC, so the 20:30 UTC run reviews an unfinished session and "final" closes aren't final. Fix: schedule in market time: `{ cron: "30 16 * * 1-5", timezone: "America/New_York" }`. The `isMarketOpenToday()` UTC date comparison has the same seasonal edge; compare dates in `America/New_York`.

### B3. `daily-stock-picks`: older unreviewed OPEN sections are silently dropped
`parseRunningState` keeps only the most recent pre-today unreviewed section (`lastTradablePicks` is overwritten in the loop). If the workflow fails for a day, that day's picks are never closed out and vanish from P&L. Fix: collect ALL unreviewed pre-today sections and review each (or at minimum log/notify the skipped ones).

### B4. `bitdoze-article-update`: `git add -A` on the whole bitdoze.com repo
`buildPushStep` stages EVERYTHING in `/home/dragos/projects/bitdoze.com`, including any unrelated uncommitted work sitting in that repo, then pushes to `main`. Fix: `git add <article path>` only. Better: push to a branch and open a PR (see N2) so a human gate exists in front of production.

### B5. Unattended agents vs approval-gated workspace tools
`video-creator` is instructed to run fully unattended, but it shares the `workspace` where `write_file`/`edit_file` have `requireApproval: true` (and `execute_command` when `REQUIRE_COMMAND_APPROVAL=true`). An unattended run stalls waiting for an approval nobody will give. Fix: create a second `Workspace` instance for automation agents (approvals off, delete still disabled, sandbox scoped to `hyperframes/`), keep the strict one for the interactive `assistant`.

### B6. Small ones
- `daily-digest` declares a `topic` input that the step never uses; either wire it into the prompt or drop it.
- `discordNotify.execute ?? fallback` called with `{} as any` context in two workflows is brittle against tool-signature changes. Extract a plain `sendDiscordNotification()` function; have both the tool and the workflows call it.
- `market-data.ts` `lastProvider()` can never return `"twelvedata"`; fix or delete it.
- README is stale ("Two agents", missing all finance/bitdoze/video work) — refresh once the above lands.

---

## 3. Security hardening

### S1. Prompt-injection: the assistant reads the live web AND can post/execute
The riskiest combination in the app: `tinyfish_fetch`/browser content flows into the same context as `postTweet`, `postBluesky`, and shell execution. A malicious page can instruct the model to tweet or run commands.
- Add `requireApproval: true` to `postTweet` and `postBluesky` (`createTool` supports it; Discord already renders Approve/Deny cards, so UX is free).
- Add input processors to the assistant: `UnicodeNormalizer` + `PromptInjectionDetector` from `@mastra/core/processors` (guardrails docs verified in installed version).
- Consider a `ModerationProcessor`/`PIIDetector` on output for the agents that publish publicly (editor -> bitdoze.com, social posts).

### S2. Tighten `authorizeUser` for the `member` role
Today members can do everything except pause/resume schedules — including triggering workflows that git-push to production and post to social media. Restrict workflow execution and editor writes to `admin`.

### S3. Server middleware: rate limiting + `/health`
Add a rate-limit middleware on `/api/*` (Mastra server middleware) and a public `/health` route for uptime monitoring + systemd watchdog integration.

### S4. Backups
`mastra.db` holds all memory/threads/schedules and `workspace/stock-portfolio.md` is the finance system's source of truth. Add a simple nightly backup (cron + rotation) for `mastra.db`, `mastra.duckdb`, and `workspace/`.

---

## 4. Code quality and maintainability

### Q1. Extract shared agent plumbing
`currentDateParts()`, `TOOL_LABELS`, `typingStatus()`, and the Discord channel config are copy-pasted across `assistant.ts`, `youtube-master.ts`, `video-creator.ts`. Extract to `src/mastra/agents/shared.ts` with a `makeDiscordChannel({ gateway })` factory. One source of truth for tool labels.

### Q2. Deduplicate workflow step schemas
`daily-stock-picks` repeats a ~15-field zod object three times (output of step 1 = input of step 2, etc.). Define shared schema constants (`reviewOutputSchema`, `decisionSchema`) next to the steps.

### Q3. Use workflow control flow instead of hand-rolled loops
Verified available in this version: `.branch()`, `.dountil()`, step-level `retries`.
- `bitdoze-article-update`: replace the `found: false` threading through 4 steps with `.branch()`; model the judge->revise loop and build->fix loop as `.dountil()` steps so each iteration is visible/traceable in Studio instead of buried in one step's execute.
- Add `retries: 2` to network-heavy steps (digest generation, review chart fetches, judge calls).

### Q4. Judge: try `structuredOutput` first
`bitdoze-judge` returns JSON-as-text parsed by `parseJudgeVerdict`. Attempt `structuredOutput` with the existing `judgeVerdictSchema` and keep the text parser as fallback; this removes a whole class of "Judge response was not valid JSON" best-effort accepts. Since 1.48.0, `structuredOutput.jsonPromptInjection: 'inline'` appends the schema instructions to the user message instead of the system prompt — use it here, it plays better with gateway prompt caching and non-OpenAI models.

### Q5. Per-purpose Memory configuration
All 6 agents share ONE `Memory` with Dragos's personal working-memory template, and all workflow calls use `resource: "workflow"` — so finance-expert, editor, and judge share a single working-memory document with a "User Profile" template none of them needs, and can pollute each other's scratchpad. Fix:
- Keep the current memory for the interactive agents (`assistant`, `youtube-master`, `video-creator`).
- Give workflow agents a lean `Memory` (semantic recall only, or nothing) or at least scope resources per pipeline (`resource: "workflow:finance"`, `"workflow:bitdoze"`).

### Q6. Tooling scripts
`package.json` has only dev/build/start. Add:
- `"typecheck": "tsc --noEmit"`
- `"test": "bun test"`
- Optionally Biome or ESLint+Prettier (nothing is configured today).

---

## 5. Adopt unused Mastra features (highest leverage)

### F1. Scorers / evals — the biggest omission
`@mastra/evals` is installed, `src/mastra/scorers/` is empty, and AGENTS.md even mandates registering scorers. Add live scorers (async, sampled, stored in `mastra_scorers`, visible in Studio):

```ts
// src/mastra/scorers/index.ts
import { createAnswerRelevancyScorer, createFaithfulnessScorer, createToolCallAccuracyScorer } from "@mastra/evals/scorers/prebuilt";
```

- `assistant`: answer-relevancy + tool-call-accuracy, `sampling: { type: "ratio", rate: 0.25 }`.
- `bitdoze-editor`: faithfulness/hallucination scorer sampled at 1.0 (protects the blog).
- Custom scorer wrapping the existing judge verdict so every article refresh lands a 0-1 score you can chart over time.
- `daily-stock-picks` decide step: a cheap rule-based step scorer validating the output format (workflow step scorers verified available).
- Later: datasets + experiments to regression-test prompt changes in CI.

### F2. Supervisor agent — one front door on Discord
Agent networks are deprecated in this version; supervisor agents are the current pattern. Create a `chief` supervisor with `agents: { assistant, youtubeMaster, videoCreator, financeExpert }` and clear `description`s on each subagent. Result: you talk to one bot that delegates ("plan a video about X, then make a short promo clip") instead of remembering which agent does what. Keep the single-gateway rule: `chief` owns the Discord gateway, others become webhook-only or Studio-only.

### F3. RAG over bitdoze.com content
You already have `LibSQLVector` + fastembed running locally — the missing piece is an index of your own content. Chunk + embed `~/projects/bitdoze.com/src/content/posts` and add a `createVectorQueryTool` to:
- `bitdoze-editor`: suggest internal links, detect overlapping/duplicate coverage before refreshing.
- `daily-digest`: ground "articles to write" ideas against what already exists (stop suggesting topics you've covered).
- `youtube-master`: pull the matching article when planning a video.
A small workflow re-indexes changed posts nightly.

### F4. Observational memory for the assistant
Verified available (`@mastra/memory` >= 1.1.0): Observer/Reflector background agents that maintain a dense observation log replacing raw history as it grows. For a long-lived personal assistant this is a better fit than semantic recall alone. Enable `observationalMemory` (pick an explicit cheap model, e.g. your gateway's fast tier, instead of the default) on the interactive assistant's memory and compare. As of 1.48.0, also set `observationalMemory.observation.manageWorkingMemory: true` so the Observer maintains the working-memory profile automatically instead of the main agent burning a tool call on it (this defaults `workingMemory.agentManaged` to false).

### F5. MCP — both directions
- **MCPClient**: replace/extend hand-rolled integrations with maintained MCP servers (GitHub official server instead of the custom REST client; filesystem/search servers as needed). Less code you own.
- **MCPServer**: expose your unique tools (bitdoze RAG, stock tools, discord-notify, minimax-tts) over MCP so Claude/other clients can reuse them outside this app.

### F6. Signals (alpha) for workflow -> agent handoff
`sendNotificationSignal()` can drop workflow results (digest ready, picks posted, article pushed) into the assistant's thread as a durable notification inbox instead of only firing Discord webhooks — so you can ask the assistant "what happened overnight?" and it has the events in-thread. It's alpha; adopt behind a small wrapper.

### F7. Voice (low priority)
You already have MiniMax TTS with a cloned voice as a tool. Wrapping it in a Mastra voice provider (`CompositeVoice`) would let agents speak responses in Studio. Nice-to-have only.

---

## 6. New product features (domain-level)

### N1. Weekly finance performance report
A Friday workflow that parses `stock-portfolio.md` and produces: equity curve, win rate by setup type, average win/loss, max drawdown, best/worst calls — written to `workspace/reports/` and posted to Discord. The data already exists; nobody aggregates it. This also feeds better "Performance context" into the daily prompt (e.g. rolling 20-trade stats instead of last 12).

### N2. Bitdoze NEW-article pipeline (not just refreshes)
Close the loop that already half-exists: daily-digest section 7 generates article ideas -> store them as a backlog (workspace file or DB table) -> a workflow picks the top idea, has the editor draft a full new post, judge reviews, build validates, then opens a **PR** (not a push to main). Human merges from the phone. This turns the digest from a report into a content engine, and the PR gate fixes the B4 risk pattern for new content.

### N3. Publish cross-post automation
When a new bitdoze article or webdoze video ships: workflow generates platform-native copy (X + Bluesky threads), optionally has `video-creator` render a 15s teaser from the article, and posts via the existing tools (behind the S1 approvals). Detect new content via the bitdoze repo (new file on main) or a YouTube RSS poll.

### N4. Digest continuity and dedupe
`daily-digest` has no memory of yesterday: it can resurface the same repos/stories daily. Keep a rolling `digest-seen.json` (or use the vector store) of items already reported; instruct/filter against it. Add "still trending (3rd day)" annotations rather than repeats.

### N5. Ad-hoc triggers from Discord
Small custom API routes or supervisor tools so you can say "run the digest now", "revise today's picks", "refresh article X" in Discord — mapped to `workflow.createRunAsync().start()`. Everything is currently cron-or-Studio only.

---

## 7. Testing & CI (currently zero)

### T1. Unit tests (`bun test`) for the pure logic
Highest value, no mocking pain:
- `parseRunningState` (multi-day logs, revision runs, missed reviews — would have caught B3)
- `reviewPick` after refactoring it to accept an injected `ChartResult` (would have caught B1)
- `parseJudgeVerdict` (fenced JSON, preamble, garbage)
- `chunkText` in discord-notify (boundary cases around 2000 chars)
- `parseFrontmatter` / stale-post selection cutoff logic
- `market-data` fallback (Yahoo 429 -> Twelve Data, cooldown behavior)

### T2. CI pipeline (GitHub Actions)
On push/PR: `bun install` -> `bun run typecheck` -> `bun test` -> `bun run build`. Optionally a nightly job running an evals dataset against the editor/judge prompts (evals-in-CI is documented and supported).

---

## 8. Suggested order of execution

| Phase | Items | Why first |
|---|---|---|
| 1. Correctness & safety | B1-B5, S1, S2 | Real money simulation (B1/B2), production pushes (B4), injection surface (S1) |
| 2. Foundation | Q6, T1, T2, B6 | Lock behavior with tests before refactors |
| 3. Refactors | Q1-Q5, S3, S4 | Cheaper to change once tested |
| 4. Mastra features | F1 (scorers), F3 (RAG), F4 (obs. memory) | Quality visibility, grounding, better memory |
| 5. Product | N1, N2, N4, N5, F2 (supervisor) | New value on a hardened base |
| 6. Exploratory | F5 (MCP), F6 (signals), N3, F7 | Nice-to-haves and alpha APIs |

Notes: every Mastra API referenced above (guardrail processors, `requireApproval` on tools, scorers on agents and workflow steps, `.branch()`/`.dountil()`/step `retries`, supervisor agents, observational memory, MCPClient/MCPServer, signals) was verified against the embedded docs of the installed `@mastra/core` / `@mastra/evals` / `@mastra/memory` packages, per AGENTS.md. Agent networks were deliberately NOT recommended (deprecated in this version).

---

## 9. AgentController: an interactive article studio (write + edit WITH you, not for you)

> Version note: the installed `@mastra/core` 1.48.0 ships **`AgentController`** (beta) from `@mastra/core/agent-controller` — verified against the embedded docs and module exports. The legacy `@mastra/core/harness` alias still exists; do not use it in new code. Beta means breaking changes can land in minor versions, so keep controller construction isolated in one module (`src/mastra/controllers/`).

### Why
`bitdoze-article-update` is a fire-and-forget batch pipeline: pick a stale post, rewrite, judge, push. Good for maintenance, wrong for AUTHORING. Writing a new article (or a heavy edit) is a collaborative session: you steer the angle, reject a section, ask for a different intro, approve publication. That is exactly the AgentController's application style: persistent session, phase switching on one thread, human-in-the-loop gates.

### Design: `articleController`
One backing editor agent, one persistent thread per article, four modes:

```ts
import { AgentController } from "@mastra/core/agent-controller";

export const articleController = new AgentController({
    id: "article-studio",
    agent: bitdozeEditor, // backing agent; modes layer on top
    modes: [
        { id: "research", name: "Research", metadata: { default: true },
          instructions: "Gather sources with tinyfish tools. Produce an outline + verified facts with URLs. Do NOT write the article yet.",
          additionalTools: { tinyfishSearch, tinyfishFetch, githubRepo, youtubeMetadata } },
        { id: "draft", name: "Draft",
          instructions: "Write the full MDX article from the approved outline, bitdoze voice rules apply." },
        { id: "edit", name: "Edit",
          instructions: "Apply the user's revision requests to the current draft. Change only what is asked; no rewrites of approved sections." },
        { id: "review", name: "Review & Publish",
          instructions: "Run final checks (frontmatter, tags, AI-pattern scan), then save via the write tool and open a PR.",
          additionalTools: { writeArticleFile, openBitdozePr } }, // approval-gated
    ],
    subagents: [
        { id: "fact-check", name: "Fact Check",
          description: "Verifies specific claims against live web sources.",
          instructions: "Verify the given claims. Return verified/false/unverifiable with URLs.",
          defaultModelId: "opencode-go/glm-5.1", maxSteps: 15 },
        { id: "judge", name: "Judge",
          description: "Independent quality review of a draft.",
          instructions: /* reuse bitdoze-judge prompt */ "...",
          defaultModelId: "opencode-go/glm-5.2" },
    ],
});
```

What each capability buys you here:
- **Modes on one thread**: research findings stay in context when you switch to draft; edit mode sees the whole history. No inline-content plumbing like the workflow does today.
- **Tool approvals**: `write_file`/`openBitdozePr` marked `requireApproval` — nothing lands in the bitdoze repo without an explicit yes (fixes the B4 pattern at the UX level).
- **Subagents**: fact-check and judge run with constrained tools on a cheaper/different model WITHOUT polluting the article thread; the parent calls the auto-generated `subagent` tool.
- **Follow-ups & steering**: queue "make the intro shorter" while a draft is still streaming, or redirect mid-run instead of waiting and re-prompting.
- **Persistent Session**: close the laptop mid-draft, resume tomorrow exactly where you left off (active mode, model, state reload).
- **Per-mode models**: cheap/fast model for research, strongest model for draft, mid-tier for edit — switchable at runtime, usage tracked.

### Integration path
1. Extract the editor voice/guidelines into shared instruction constants (reused by mode instructions and the existing workflow agent).
2. Build `articleController` + the two approval-gated tools (`writeArticleFile` scoped to the posts dir, `openBitdozePr` doing branch + PR instead of push-to-main).
3. Front-end: start with a minimal CLI (subscribe to events, print `message_update`, prompt on `tool_approval_required`) or custom API routes bridging events over SSE/WebSocket; a small Bun-served web UI later. Approval flows are restart-safe as of 1.48.0: `agent.listSuspendedRuns()` reads pending approvals from storage (also exposed as `GET /agents/:agentId/suspended-runs`), and `sendToolApproval()` falls back to it — so a pending "publish?" gate survives a server restart or page refresh.
4. Keep `bitdoze-article-update` for unattended stale-post refreshes; the controller is for new articles and hands-on edits. Both share the same tools, voice constants, and (once F1 lands) the same scorers.

### Other AgentController use cases in THIS app
- **Video-creation copilot**: modes `brief -> storyboard -> build -> render`, with `render` (Docker, minutes-long) and `minimax_tts` (paid credits) approval-gated. Fixes B5 the right way: interactive runs get gates, and the same backing agent stays usable unattended elsewhere. Steering shines here ("swap scene 3's color") while a build is in progress.
- **Finance review console**: a `review` mode to interrogate the portfolio log ("why did the NVDA stop fire?") and a `decide` mode where a manual pick revision requires your approval before it overwrites today's OPEN section. The scheduled workflow keeps running unattended; the controller is the manual override surface. (Signals, which the controller's follow-ups are built on, become the bridge: the workflow can notify the session's thread.)
- **Assistant upgrade path**: long-term, the Discord/Studio `assistant` maps naturally to a controller session (persistent state, observational memory, permission grants like "allow shell commands for this session"). Do not do this first; it's the largest surface and Discord channels already cover most of it.

### AgentController vs Workflow vs plain Agent: decision rule for this codebase
| Use | When | In this app |
|---|---|---|
| **Workflow** | Unattended, scheduled, deterministic step graph; retries/branching; no human present; result is a side effect (file, push, post) | `daily-digest`, `daily-stock-picks`, stale-post refresh, nightly RAG re-index (F3), backups (S4), publish cross-posting (N3) |
| **AgentController** | A human collaborates across phases on ONE evolving artifact; approvals, steering, resumable sessions | Article studio (this section), video copilot, finance review console |
| **Plain Agent call** | One-shot request/response inside a workflow step or API route | Judge verdicts, digest generation step, finance decide step |

Rule of thumb: if nobody is watching, it is a workflow; if you are in the loop shaping the output, it is an AgentController session; if it is a single bounded LLM task, it is an agent call inside one of the above. The hybrid pattern (workflow does the scheduled work, controller is the human console over the same artifacts and tools) is the end state to aim for.

Placement in the roadmap: build the article studio in Phase 5 alongside N2 (they share the PR-not-push tooling); the video copilot and finance console fit Phase 6. AgentController is beta: pin `@mastra/core` upgrades deliberately, keep all controller construction in `src/mastra/controllers/`, and re-check the embedded docs after each minor bump.

---

## 10. @mastra/core 1.48.0 release — impact on this plan

Checked against the July 1, 2026 release notes. **Nothing in this codebase breaks**: the only breaking change is the `@mastra/vercel` sandbox rename (not used here; this app uses `LocalSandbox`), and the AgentController `heartbeatHandlers` -> `intervalHandlers` rename only affects code that used interval handlers (none yet). What the release DOES change is the best tool for several recommendations above:

### Heartbeats: a third scheduling primitive (adopt)
`mastra.heartbeats` runs an agent on a persisted cron — into an existing thread as a signal, or threadless — with CRUD over `/api/heartbeats` and lifecycle hooks (`prepare`/`onFinish`/`onError`) on the `Mastra` constructor. Combined with the 1.48.0 channel-broadcasting fix (runs on a channel-backed thread now post back to Discord even when not triggered by a Discord message), this changes the calculus:

- **`daily-digest` is a heartbeat candidate**: it is literally "run the assistant with a prompt on a cron, deliver the result to Discord". A heartbeat on a Discord-backed thread gets delivery for free — no `discordNotify` webhook glue, no workflow wrapper. Keep the workflow only if you want the file-write step and retries to stay deterministic; a middle ground is a thin workflow that only persists the file while a heartbeat owns the conversation delivery.
- **`daily-stock-picks` and `bitdoze-article-update` stay workflows**: multi-step orchestration, file/git side effects, P&L math, and judge loops need deterministic steps, retries, and traceable state — exactly what heartbeats are not for.
- **F6 (signals) gets simpler**: heartbeats ARE persisted signal senders. The "what happened overnight?" inbox pattern can be a morning heartbeat summarizing workflow outputs into the assistant's thread instead of hand-rolled `sendNotificationSignal` plumbing.
- **N1 (weekly finance report)**: fits a threadless heartbeat if the aggregation moves into agent tools; otherwise keep it a workflow.

Updated decision rule (extends the section 9 table): **heartbeat** when the scheduled thing is "one agent + one prompt, result belongs in a conversation"; **workflow** when it is a deterministic multi-step pipeline with side effects; they compose (workflow computes, heartbeat narrates).

### Approval reliability (already folded into section 9)
`agent.listSuspendedRuns()` + storage-backed `sendToolApproval()` fallback make the approval gates in S1/B5/section 9 restart-safe. This also unblocks building the approval UX over plain HTTP for Discord-less contexts.

### Smaller adoptions
- **Goal judge control**: `GoalConfig` now accepts `maxSteps` for the judge's internal loop (default was an implicit 5), and a bug where the goal judge missed Mastra registration (silent API-key resolution failures) is fixed — worth a re-test of the assistant's `goal: { judge, maxRuns: 50 }` flow, and set an explicit `maxSteps` if judge verdicts were shallow.
- **`structuredOutput.jsonPromptInjection: 'inline'`** — folded into Q4 (judge).
- **OM-managed working memory** — folded into F4.
- **File-based agents** (`src/mastra/agents/<name>/` with `config.ts`/`instructions.md`/`tools/`/`subagents/`): optional alternative to code registration. Not recommended as a migration (code-registered agents win on collisions and this app's agents are heavily programmatic — dynamic instructions, channels, shared memory), but new simple agents could use it to keep instructions in Markdown.
- **Scheduler process-exit fix**: one-off scripts importing the `mastra` instance no longer hang at exit — relevant if T1 tests or maintenance scripts import it.
- **Thread metadata fix**: mid-run `updateThread` metadata writes are no longer lost — removes a foot-gun if the controller/state work in section 9 stores per-article state in thread metadata.
