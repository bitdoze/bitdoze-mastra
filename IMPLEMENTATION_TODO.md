# Implementation TODO — Agentic Coding & Research Assistant

Derived from `PRD.md` (Draft v1.3). Tasks are ordered to be done **one by one**, grouped by the milestones in PRD §11. Check off each item as it lands.

**Ground rules (from `AGENTS.md` / `CLAUDE.md`):**
- Load the `mastra` skill before any Mastra work; verify every API against installed packages.
- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`.
- Use `bun run dev` / `bun run build` (not `mastra dev` / `mastra build` directly).
- Default to Bun for all scripts/tooling.

---

## Phase 0 — Foundation

> Exit: agent reads/writes files and runs approved shell commands in Studio.

- [ ] **0.1** Add `.gitignore` entries: `.env`, `workspace/`, `mastra.db`, `*.db`, `*.db-*`. *(Safety §9)*
- [ ] **0.2** Create `.env.example` with all vars from PRD §7 (no real secrets). Confirm Bun auto-loads `.env`.
- [ ] **0.3** Wire LibSQL store URL to `DATABASE_URL` env (default `file:./mastra.db`) in `src/mastra/index.ts` — stop hardcoding. *(F-MEM-6)*
- [ ] **0.4** Verify `opencode-go` provider + `glm-5.2`/`glm-5.1` via `provider-registry.mjs`; add `OPENCODE_GO_API_KEY`. *(F-MODEL-1..4)*
- [ ] **0.5** Add model config: `AGENT_MODEL` (default `opencode-go/glm-5.2`), `AGENT_JUDGE_MODEL` (default `opencode-go/glm-5.1`).
- [ ] **0.6** Create `src/mastra/memory.ts` — `Memory` on the existing composite store, semantic recall on. *(F-MEM-1..5)*
- [ ] **0.7** Create `src/mastra/workspaces.ts` — `Workspace` with `LocalFilesystem(basePath:./workspace)` + `LocalSandbox(workingDirectory:./workspace)`. *(F-WS-1)*
- [ ] **0.8** Configure workspace tools: `requireApproval:true` on `WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND`, `requireReadBeforeWrite:true` on writes, delete disabled, `maxOutputTokens:5000`. *(F-WS-3,4,5,8)*
- [ ] **0.9** Enable `lsp:true` and `bm25:true`; apply tool name remapping (`view`, `grep`, `list_files`, `execute_command`, `lsp_inspect`). *(F-WS-6,7,9)*
- [ ] **0.10** Create `src/mastra/agents/assistant.ts` — the **general-purpose agent** with model, memory, workspace tools. *(F-MODEL, §4)*
- [ ] **0.11** Register the `assistant` agent (id `assistant`), workspace, and storage in `src/mastra/index.ts`.
- [ ] **0.12** **Remove** the `weatherAgent`, `weatherWorkflow`, and the 3 weather scorers (`toolCallAppropriatenessScorer`, `completenessScorer`, `translationScorer`) from `src/mastra/index.ts` — delete their imports and registrations. The `assistant` agent is now the single general-purpose agent (no weather agent).
- [ ] **0.13** Verify in Studio (`bun run dev`): file create → read → edit → grep round-trip; approved shell command runs. *(Success metrics 1-2)*

## Phase 1 — Web tools

> Exit: agent answers live-web questions and fetches pages.

- [ ] **1.1** Create `src/mastra/tools/tinyfish-search.ts` — wraps `GET https://api.search.tinyfish.ai`, `X-API-Key`; input `query`/`location`/`language`/`page`/`include_thumbnail`; returns `position/domain/title/snippet/url`. *(F-TF-S1..4)*
- [ ] **1.2** Create `src/mastra/tools/tinyfish-fetch.ts` — wraps `POST https://api.fetch.tinyfish.ai`; input `urls`(max 10)/`format`(md default)/`links`/`image_links`/`ttl`/`per_url_timeout_ms`; per-URL results + non-fatal `errors[]`. *(F-TF-F1..5)*
- [ ] **1.3** Add `TINYFISH_API_KEY`; handle rate limits (search 30/min, fetch 150 URLs/min). *(F-TF-S4, F-TF-F5, P6)*
- [ ] **1.4** Register both tools on the `assistant` agent and in `index.ts`.
- [ ] **1.5** Create `skills/research/SKILL.md` (web search → fetch workflow), referencing both tools. *(F-SKILL-6)*
- [ ] **1.6** Verify: agent answers a factual question via search then summarizes a page via fetch. *(Success metric 3)*

## Phase 2 — Browser

> Exit: agent automates a login-free page flow.

- [ ] **2.1** Verify exact package name/version for `@mastra/agent-browser`; install it + `ws` + `@hono/node-ws`. *(§6, F-BR-4)*
- [ ] **2.2** Create `src/mastra/browsers.ts` — `AgentBrowser`, `BROWSER_HEADLESS` (default true), optional `BROWSER_CDP_URL`. *(F-BR-1,2,3)*
- [ ] **2.3** Attach browser to the `assistant` agent; enable screencast for Studio. *(F-BR-4,5)*
- [ ] **2.4** Verify: agent navigates a JS-heavy page and extracts structured data. *(Success metric 4)*

## Phase 3 — Discord

> Exit: agent responds to a Discord mention with an approved tool call.

- [ ] **3.1** Confirm Discord adapter package + env var names (`@chat-adapter/discord` vs `chat-sdk.dev`); install. *(F-DC-1, §6)*
- [ ] **3.2** Add Discord env: `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_WEBHOOK_SECRET`. *(F-DC-6)*
- [ ] **3.3** Wire `createDiscordAdapter()` channel on the `assistant` agent; expose webhook `/api/agents/assistant/channels/discord/webhook`. *(F-DC-1,2)*
- [ ] **3.4** Handle DMs + mentions, multi-user (sender name/ID prefix); last-10-message bootstrap then Mastra memory. *(F-DC-3,5)*
- [ ] **3.5** Render approval-required tools as Approve/Deny cards in Discord. *(F-DC-4)*
- [ ] **3.6** Document local tunnel (ngrok/cloudflared) for `:4111`. *(F-DC-7)*
- [ ] **3.7** Verify: mention triggers an approved tool call; preference remembered across two sessions. *(Success metrics 5)*

## Phase 4 — Goals & skills

> Exit: agent completes a multi-iteration goal and loads a skill on demand.

- [ ] **4.1** Add `goal` block to agent: `{ judge: AGENT_JUDGE_MODEL, maxRuns: 50 }`. *(F-GOAL-1)*
- [ ] **4.2** Implement objective setting with correct API: `agent.setObjective(objective, { threadId, resourceId })` (string first arg; `judgeModelId` for per-objective override). *(F-GOAL-2 corrected)*
- [ ] **4.3** Project `<current-objective>` into context; emit `goal` stream chunks; keep objective `active` when `maxRuns` exhausted. *(F-GOAL-3,4,5)*
- [ ] **4.4** Wire Discord `!goal <objective>` command for the current thread. *(F-GOAL-6)*
- [ ] **4.5** Configure workspace `skills: ['skills']`; ensure auto-discovery via `skill`/`skill_read`/`skill_search` + BM25 indexing. *(F-SKILL-1,3,5)*
- [ ] **4.6** Create `skills/engineering/SKILL.md` (test/lint/build workflow). *(F-SKILL-6)*
- [ ] **4.7** Verify: a new skill dropped into `./skills` is discovered without code changes; a `!goal` runs across iterations until judged done. *(Success metrics 6-7)*

## Phase 5 — Auth & scheduling

> Exit: Studio is login-gated; scheduled workflow fires and is pausable; roles enforced.

- [ ] **5.1** Confirm EE-licensing implications of `StaticRBACProvider` (`/ee` path) before committing. *(F-AUTH-5 note)*
- [ ] **5.2** Create `src/mastra/auth.ts` — `SimpleAuth({ users })` (token→user), env-driven; seed one `admin` + one `member`. *(F-AUTH-1,10)*
- [ ] **5.3** Add `StaticRBACProvider` + `DEFAULT_ROLES`; `getUserRoles: u => [u.role]`. *(F-AUTH-5,6)*
- [ ] **5.4** Set `server.auth` + `server.rbac` in `index.ts`; map `{resource}:{action}` perms (incl. `execute_command` and `schedules:write` gating). *(F-AUTH-7,8,9)*
- [ ] **5.5** Verify Studio login screen + token passthrough (`?auth_header=Bearer%20<token>`). *(F-AUTH-3,4)*
- [ ] **5.6** Create `src/mastra/workflows/daily-digest.ts` with `schedule: { cron, timezone, inputData }` (IANA tz); runs agent over TinyFish results → markdown to workspace. *(F-SCHED-1,2,3,11)*
- [ ] **5.7** Confirm schedule auto-registration on boot; verify `/workflows/schedules` shows cron/next-fire/last-run; test pause/resume durability. *(F-SCHED-5,6,7,8)*
- [ ] **5.8** Verify: unauth request rejected; valid token scoped to role; digest fires on cron and is pausable. *(Success metrics 8-9)*

## Phase 6 — Hardening

> Exit: stable run under mixed workload.

- [ ] **6.1** Review observability traces; confirm `SensitiveDataFilter` redacts secrets. *(§9)*
- [ ] **6.2** Add TinyFish rate-limit backoff/retry + clear error UX surfaced to Discord. *(P6)*
- [ ] **6.3** Confirm output truncation tuned across tools (tokens + line tail). *(F-WS-8)*
- [ ] **6.4** Run `bun run build` clean; run `bun test`; smoke-test full workload (file + web + browser + goal + schedule).
- [ ] **6.5** Document deploy on a long-lived host (scheduler needs persistent process — no serverless). *(§6 deployment note)*

---

## Cross-cutting checklist (apply throughout)

- [ ] Every new agent/tool/workflow/scorer registered in `src/mastra/index.ts`.
- [ ] All model names validated via `provider-registry.mjs` before use.
- [ ] No secrets committed; `.env` git-ignored.
- [ ] `bun run dev` boots clean after each phase.
