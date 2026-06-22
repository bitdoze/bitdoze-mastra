# PRD: Agentic Coding & Research Assistant (Mastra)

**Status:** Draft v1.3
**Platform:** Mastra (TypeScript, Bun)
**Last updated:** 2026-06-22

---

## 1. Vision & Overview

Build a general-purpose agentic assistant on the Mastra framework that can **read and write files**, **execute shell commands**, **search and fetch the live web**, **automate a browser**, **persist memory across sessions**, **pursue durable goals**, **collaborate over Discord**, **run on cron schedules**, and **expose a login-protected Studio UI**, while staying **extensible through a skills system**.

The agent is powered by a model served through the **OpenCode Go** gateway and lives inside a Mastra **Workspace** that gives it a real filesystem, sandbox, and code-intelligence tools. Access to the Studio UI and API is gated by Mastra's built-in auth, and recurring work runs on Mastra's built-in scheduler.

### Why this product

- One agent that spans **local engineering work** (files, shell, code navigation) and **live-web research** (search, fetch, browse).
- **Discord-native** so teammates can hand off tasks and approve actions in chat.
- **Goal-driven** so it can be pointed at an objective and iterate until done.
- **Scheduled** so standing jobs (daily digests, syncs, sweeps) run without external cron.
- **Secure by default** so the Studio UI and API are behind a login with role-based permissions.
- **Skills-based** so capabilities grow without touching core code.

---

## 2. Goals & Non-Goals

### Goals
- G1. An agent that can read/write/move/grep files in a local workspace.
- G2. An agent that can run shell commands (with approval) in a sandbox tied to the workspace.
- G3. Web **search** (TinyFish) and clean-content **fetch** (TinyFish) as first-class tools.
- G4. Full **browser automation** for pages that need JS, login, or interaction.
- G5. **Persistent memory** so conversations and learned facts survive restarts.
- G6. **Durable goals** so the agent iterates on a task until a judge model is satisfied.
- G7. A **Discord channel** so the agent answers mentions and DMs with tool-approval cards.
- G8. A pluggable **skills** system so new instructions/capabilities can be added as folders.
- G9. Reasonable **safety rails** (approvals on destructive tools, read-before-write, output truncation).
- G10. A **scheduler** so workflows run on cron cadences (daily reports, sweeps, syncs) without external tooling.
- G11. **Authenticated Studio access** so only authorized users reach the UI and API, with role-based permissions.

### Non-Goals (v1)
- Multi-tenant cloud deployment / per-user sandboxing isolation beyond local.
- A custom web UI (Mastra Studio is used for inspection; Discord is the chat surface).
- Serverless deployment (the built-in scheduler requires a long-lived host process).
- Fine-tuning or custom model hosting.
- Slack/Telegram channels (Discord only in v1; channels are additive later).

---

## 3. Personas & Target Users

| Persona | Need |
|---|---|
| **Solo developer** | Delegate chores (run tests, search docs, scaffold files) via chat. |
| **Small team on Discord** | Hand the agent standing objectives; review/approve risky actions in-channel. |
| **Researcher** | Combine live-web search/fetch with local note-taking and browser sessions. |

---

## 4. High-Level Architecture

```
                         ┌─────────────────────────────────────┐
                         │            Mastra Server            │
                         │   Studio @ :4111 (login + RBAC)     │
                         │   API routes (auth required)        │
                         │   Scheduler (cron tick loop)        │
                         └───────────────┬─────────────────────┘
                                         │ registers
              ┌──────────────────────────┼───────────────────────────┐
              │                          │                            │
      ┌───────▼────────┐        ┌────────▼─────────┐        ┌─────────▼────────┐
      │   assistant     │        │   Workspace      │        │     Memory       │
      │  (general-use)  │        │  filesystem +    │        │  LibSQL/DuckDB   │
      │  + goals        │        │  sandbox + LSP + │        │  threads         │
      │  + channels     │        │  skills + search │        │  + semantic recall│
      └───────┬─────────┘        └────────┬─────────┘        └──────────────────┘
              │ (tools)                    │ (tools)
   ┌──────────┼───────────┐      ┌─────────┼──────────┐
   │          │           │      │         │          │
tinyfish  tinyfish    AgentBrowser  read/   shell     lsp_inspect/
 search    fetch     (Playwright)   write   execute   skill_*

   ┌──────────────────┐         ┌──────────────────────────────┐
   │  SimpleAuth      │         │  Scheduled workflows         │
   │  (token→user)    │         │  (schedule.cron, auto-fire)  │
   │  + StaticRBAC    │         │  Studio /workflows/schedules │
   └──────────────────┘         └──────────────────────────────┘
```

### Component responsibilities
- **assistant** — the single **general-purpose** Mastra `Agent` (id: `assistant`). Owns instructions, model, tools, memory, goals, and browser. Discord is just one channel surface attached to it; the agent itself is general-purpose (files, shell, web search/fetch, browser, goals, skills). The previous `weatherAgent`/`weatherWorkflow`/weather scorers are removed.
- **Workspace** — local filesystem + local sandbox pointing at the same directory; skills directory enabled; BM25 search enabled; LSP enabled.
- **Memory** — thread-scoped, persisted via the composite LibSQL + DuckDB storage already in the project.
- **TinyFish tools** — custom Mastra tools wrapping the Search and Fetch APIs.
- **AgentBrowser** — Playwright-based provider attached to the agent for real browser sessions.
- **SimpleAuth + StaticRBACProvider** — built-in auth provider mapping tokens to users and enforcing the four default roles (owner/admin/member/viewer) on both Studio and API.
- **Scheduled workflows** — workflows declaring a `schedule: { cron, timezone, inputData }` field, auto-registered at boot and visible/pausable in Studio.

---

## 5. Functional Requirements

### 5.1 Core Agent & Model

| Req | Description |
|---|---|
| F-MODEL-1 | The agent uses the **OpenCode Go** gateway via the `opencode-go/<model>` format. |
| F-MODEL-2 | Default model: **`opencode-go/glm-5.2`** (strong general model in the catalog). |
| F-MODEL-3 | Model is configurable via env var (`AGENT_MODEL`) with `opencode-go/glm-5.2` as default. |
| F-MODEL-4 | Judge model for goals uses a cheaper/faster model (e.g. `opencode-go/glm-5.1`) configurable via env (`AGENT_JUDGE_MODEL`). |

**Available OpenCode Go models** (verified against Mastra provider registry):
`glm-5.2`, `glm-5.1`, `deepseek-v4-pro`, `deepseek-v4-flash`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.6-plus`, `minimax-m3`, `minimax-m2.7`, `kimi-k2.7-code`, `kimi-k2.6`, `mimo-v2.5-pro`, `mimo-v2.5`.

### 5.2 Workspace (Filesystem + Shell + LSP + Search)

| Req | Description |
|---|---|
| F-WS-1 | A `Workspace` with `LocalFilesystem` (`basePath: ./workspace`) and `LocalSandbox` (`workingDirectory: ./workspace`) so files written are immediately executable. |
| F-WS-2 | File tools exposed: `read_file`, `write_file`, `list_files`, `move_file`, `grep`, etc. |
| F-WS-3 | Shell execution via `execute_command` (mapped from `WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND`) with **`requireApproval: true`**. |
| F-WS-4 | **Read-before-write** enforced on write tools (`requireReadBeforeWrite: true`) to prevent blind overwrites. |
| F-WS-5 | **Delete tool disabled** in v1 (`WORKSPACE_TOOLS.FILESYSTEM.DELETE.enabled = false`) for safety. |
| F-WS-6 | LSP inspection enabled (`lsp: true`) for hover/definition/implementation queries. |
| F-WS-7 | BM25 search enabled (`bm25: true`) so the agent can grep/semantic-search the workspace and skills. |
| F-WS-8 | Output truncation tuned: `maxOutputTokens: 5000` for `execute_command` to fit build/test output. |
| F-WS-9 | Tool name remapping to match coding-agent conventions (`view`, `grep`, `list_files`, `execute_command`, `lsp_inspect`). |

### 5.3 Skills System

| Req | Description |
|---|---|
| F-SKILL-1 | Workspace `skills: ['skills']` points at a project `./skills` directory. |
| F-SKILL-2 | Each skill follows the Agent Skills spec: a folder with `SKILL.md` (+ optional `references/`, `scripts/`, `assets/`). |
| F-SKILL-3 | Agents auto-discover skills in the system message and load them on demand via the `skill`, `skill_read`, and `skill_search` tools. |
| F-SKILL-4 | Operators can **add a skill** simply by dropping a folder into `./skills` and reloading. |
| F-SKILL-5 | Skills are indexed by BM25 so the agent can search across skill content. |
| F-SKILL-6 | Ship with 2 starter skills: `research` (web search/fetch workflow) and `engineering` (test/lint/build workflow). |

### 5.4 TinyFish Tools (Search + Fetch)

Custom Mastra tools wrapping the TinyFish REST APIs (both free, no credits consumed).

#### 5.4.1 `tinyfish_search`

| Req | Description |
|---|---|
| F-TF-S1 | Wraps `GET https://api.search.tinyfish.ai` with header `X-API-Key`. |
| F-TF-S2 | Input schema: `query` (string, required), `location` (optional, default `US`), `language` (optional, default `en`), `page` (optional, 0-10), `include_thumbnail` (optional bool). |
| F-TF-S3 | Returns structured results: `position`, `domain`, `title`, `snippet`, `url`. |
| F-TF-S4 | API key from env `TINYFISH_API_KEY`. Rate limit: 30 req/min (Free). |

#### 5.4.2 `tinyfish_fetch`

| Req | Description |
|---|---|
| F-TF-F1 | Wraps `POST https://api.fetch.tinyfish.ai` with header `X-API-Key`. |
| F-TF-F2 | Input schema: `urls` (string[], required, max 10), `format` (optional: `markdown` default, `html`, `json`), `links` (optional bool), `image_links` (optional bool), `ttl` (optional seconds), `per_url_timeout_ms` (optional). |
| F-TF-F3 | Returns per-URL `title`, `description`, `text`, `final_url`; failures surface in `errors[]` without failing the whole call. |
| F-TF-F4 | Default `format: "markdown"` (best for LLM consumption). |
| F-TF-F5 | API key from env `TINYFISH_API_KEY`. Rate limit: 150 URLs/min (Free). |

Both tools are registered on the agent and also referenced by the `research` starter skill.

### 5.5 Browser Automation

| Req | Description |
|---|---|
| F-BR-1 | Use **AgentBrowser** (`@mastra/agent-browser`, Playwright-based, accessibility-first). |
| F-BR-2 | Configurable headless mode via env (`BROWSER_HEADLESS`, default `true`). |
| F-BR-3 | Optional CDP URL for cloud browsers via env (`BROWSER_CDP_URL`). |
| F-BR-4 | Screencast enabled for live viewing in Mastra Studio (requires `ws` + `@hono/node-ws` deps). |
| F-BR-5 | Agent gets browser tools to navigate, click, type, read page content, and extract data. |

### 5.6 Memory

| Req | Description |
|---|---|
| F-MEM-1 | Agent uses `@mastra/memory` with a `Memory` instance. |
| F-MEM-2 | Memory backed by the existing composite storage (LibSQL default + DuckDB for observability). |
| F-MEM-3 | Thread-scoped context; each Discord conversation gets its own thread/resource. |
| F-MEM-4 | Semantic recall enabled so the agent retrieves relevant past turns. |
| F-MEM-5 | Memory survives process restarts (persisted to storage). |
| F-MEM-6 | The LibSQL store URL is read from the `DATABASE_URL` env var (default `file:./mastra.db`), not hardcoded. `src/mastra/index.ts` currently hardcodes `url: "file:./mastra.db"` and must be wired to the env var. |

### 5.7 Goals

| Req | Description |
|---|---|
| F-GOAL-1 | Agent configured with a `goal` block: `{ judge: <judge-model>, maxRuns: 50 }`. |
| F-GOAL-2 | Objectives are set per-thread via `agent.setObjective(objective, { threadId, resourceId })` — the objective **string is the first positional arg**, options are second. Per-objective judge override uses `judgeModelId`; the agent-level default is set via `goal.judge`. |
| F-GOAL-3 | The current objective is projected into context as `<current-objective>` so the model always sees it. |
| F-GOAL-4 | Each iteration emits a `goal` stream chunk for progress visibility in Studio. |
| F-GOAL-5 | If `maxRuns` is exhausted, the objective stays `active` so raising the budget can resume it. |
| F-GOAL-6 | Discord command `!goal <objective>` sets a durable goal for the current thread. |

### 5.8 Discord Channel

| Req | Description |
|---|---|
| F-DC-1 | Discord adapter from `@chat-adapter/discord` (`createDiscordAdapter()`). **Verify the exact npm package name, version, and env var names at install time** — the reference link points to `chat-sdk.dev` while the dependency is listed as `@chat-adapter/discord`; neither is installed yet, so confirm which is correct before wiring. |
| F-DC-2 | Agent exposes a channel webhook at `/api/agents/assistant/channels/discord/webhook`. |
| F-DC-3 | Responds to **DMs** and **mentions** in servers; multi-user aware (sender name + ID prefixed). |
| F-DC-4 | **Tool approval**: destructive/approval-required tools render as interactive Approve/Deny cards in Discord. |
| F-DC-5 | Thread context: fetches last 10 platform messages on first mention, then uses Mastra memory. |
| F-DC-6 | Credentials from env (`DISCORD_*` per the chat-adapter docs). |
| F-DC-7 | Local dev requires a tunnel (ngrok/cloudflared) to expose `:4111`. |

### 5.9 Scheduler (Scheduled Workflows)

Mastra's built-in cron-style scheduling (`@mastra/core@1.32.0+`) fires workflows on cron expressions. Declaring a `schedule` field auto-registers the workflow with the scheduler when `Mastra` boots, no separate register call needed. The scheduler is a `setInterval` tick loop that polls the schedules table and dispatches runs via in-process pubsub, so it requires a **long-lived host process** (not serverless).

| Req | Description |
|---|---|
| F-SCHED-1 | Workflows declare a `schedule: { cron, timezone, inputData }` field; the scheduler picks them up automatically on boot. |
| F-SCHED-2 | `cron` is a 5-, 6-, or 7-part cron expression, validated at workflow construction time. |
| F-SCHED-3 | `timezone` set explicitly (IANA name, e.g. `America/New_York`) so fire times don't depend on server locale. |
| F-SCHED-4 | Multiple cadences per workflow supported via `schedule: [{ id, cron, inputData }, ...]` with unique stable `id` per entry. |
| F-SCHED-5 | Scheduled workflows auto-promote to the evented execution engine; requires a storage adapter supporting concurrent updates (LibSQL satisfies this). |
| F-SCHED-6 | Schedules visible in Studio at `/workflows/schedules` with cron, next fire, and last run status; detail page shows trigger history + run graph links. |
| F-SCHED-7 | Pause/resume at runtime via `MastraClient.pauseSchedule()`/`resumeSchedule()` or Studio buttons; pause is durable across restarts and redeploys. |
| F-SCHED-8 | Schedule ids derived from workflow id: `wf_<workflowId>` (single) or `wf_<workflowId>__<scheduleId>` (multiple). |
| F-SCHED-9 | Pause/resume require `schedules:write` permission (see 5.10). |
| F-SCHED-10 | Redeploys diff existing rows: cron/timezone changes recompute `nextFireAt`; user-set paused status and fire history are preserved. |
| F-SCHED-11 | Ship 1 starter scheduled workflow: `daily-digest` that runs the agent over TinyFish search results for tracked topics and writes a markdown summary to the workspace. |

### 5.10 User Authentication & RBAC (Studio + API)

Mastra's `server.auth` gates both the Studio UI (login screen) and all API routes (`/api/agents/*`, `/api/workflows/*`, etc.) with one configuration. RBAC (`server.rbac`) controls what each authenticated user can see and do.

| Req | Description |
|---|---|
| F-AUTH-1 | Configure `server.auth: new SimpleAuth({ users })` mapping API keys/tokens to user objects `{ id, name, role }`. |
| F-AUTH-2 | Without auth, Studio and all routes are public, so auth is mandatory for any non-local deployment. |
| F-AUTH-3 | Studio auto-renders a login screen; calls `GET /api/auth/capabilities` to decide which login methods to show. |
| F-AUTH-4 | Token passthrough via `?auth_header=Bearer%20<token>` URL param for embedded Studio sessions (transient, in-memory only). |
| F-AUTH-5 | Enable `StaticRBACProvider` with `DEFAULT_ROLES` (owner/admin/member/viewer) from `@mastra/core/auth/ee`. **Note:** this provider lives under the enterprise (`/ee`) path — confirm whether using `StaticRBACProvider` itself requires an EE license for your deployment before committing P5 to it. |
| F-AUTH-6 | `getUserRoles: user => [user.role]` maps the SimpleAuth user role to RBAC roles. |
| F-AUTH-7 | Permissions follow `{resource}:{action}` (resources: agents, workflows, tools, datasets, memory, scores, observability, schedules; actions: read, write, execute, delete). |
| F-AUTH-8 | Studio hides UI actions the user lacks permission for (e.g. viewer sees no delete buttons; member can't edit agents). |
| F-AUTH-9 | Shell execution (`execute_command`) and schedule pause/resume gated by appropriate permissions for the calling user. |
| F-AUTH-10 | Users defined in env-driven config; default seeded roles: one `admin` (full) and one `member` (read+execute) for v1. |
| F-AUTH-11 | Upgrade path: swap `SimpleAuth` for a third-party provider (Clerk, WorkOS, Auth0, Better Auth, Supabase, Okta, Firebase) without touching agent code; production SSO requires an EE license. |

---

## 6. Technical Stack & Dependencies

### Existing (keep)
- `@mastra/core`, `@mastra/memory`, `@mastra/libsql`, `@mastra/duckdb`, `@mastra/evals`, `@mastra/loggers`, `@mastra/observability`, `zod`
- Runtime: **Bun**; scripts: `bun run dev|build|start`

### To add
| Package | Purpose |
|---|---|
| `@chat-adapter/discord` | Discord channel adapter |
| `@mastra/agent-browser` | Playwright browser provider (not yet installed — verify package name + version at install time) |
| `ws`, `@hono/node-ws` | Screencast WebSocket support |
| `@tiny-fish/sdk` *(optional)* | TinyFish SDK (or call REST directly via `fetch`) |

### Built into `@mastra/core` (no extra package)
| Feature | Module |
|---|---|
| Scheduler (cron workflows) | `schedule` field on `createWorkflow` |
| SimpleAuth | `@mastra/core/server` |
| StaticRBACProvider + DEFAULT_ROLES | `@mastra/core/auth/ee` |

### Provider/model
- `opencode-go/glm-5.2` (default), requires `OPENCODE_GO_API_KEY` env (per provider registry).

### Deployment note
The built-in scheduler requires a **long-lived host process** (Fly Machines, Railway, Render, ECS, GKE, a VPS). Serverless platforms (Vercel/Lambda/Cloudflare Workers) won't fire scheduled workflows; use `@mastra/inngest` there instead.

---

## 7. Configuration & Environment

```bash
# .env
# --- Model (OpenCode Go) ---
OPENCODE_GO_API_KEY=...
AGENT_MODEL=opencode-go/glm-5.2
AGENT_JUDGE_MODEL=opencode-go/glm-5.1

# --- TinyFish (free) ---
TINYFISH_API_KEY=...

# --- Discord ---
# (see @chat-adapter/discord docs for exact var names)
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
DISCORD_APPLICATION_ID=...
DISCORD_WEBHOOK_SECRET=...

# --- Browser ---
BROWSER_HEADLESS=true
# BROWSER_CDP_URL=...        # optional cloud browser

# --- Studio Auth (SimpleAuth) ---
# Users are defined in code/config; tokens are the keys.
# Example: admin token + member token. Rotate before production.
# (see src/mastra/auth.ts for the users map)

# --- Storage ---
DATABASE_URL=file:./mastra.db
```

---

## 8. Target Project Structure

```
src/mastra/
  index.ts                  # Mastra instance: agents, workflows, workspace, storage, auth, rbac, observability
  agents/
    assistant.ts            # the general-purpose agent (model, tools, memory, goals, channels, browser)
  tools/
    tinyfish-search.ts      # TinyFish Search tool
    tinyfish-fetch.ts       # TinyFish Fetch tool
  workspaces.ts             # Workspace config (filesystem + sandbox + skills + bm25 + lsp)
  browsers.ts               # AgentBrowser instance
  memory.ts                 # Memory instance
  auth.ts                   # SimpleAuth users map + StaticRBACProvider config
  workflows/
    daily-digest.ts         # scheduled workflow (cron) for topic digests
skills/                     # Agent Skills directory (loaded by workspace)
  research/
    SKILL.md
  engineering/
    SKILL.md
workspace/                  # local filesystem + sandbox working dir (gitignored)
```

### Registration (per AGENTS.md rules)
All agents, tools, workflows, and scorers registered in `src/mastra/index.ts`. Use `bun run dev` / `bun run build`.

---

## 9. Safety & Security

| Control | Where |
|---|---|
| Shell commands require approval | Workspace tool config (`requireApproval: true`) |
| Delete disabled | Workspace tool config |
| Read-before-write enforced | Workspace tool config |
| Output truncation (tokens + line tail) | Workspace default + tuned per tool |
| Sensitive data redaction in traces | `SensitiveDataFilter` (already configured) |
| Discord tool-approval cards | Channel adapter renders Approve/Deny for `requireApproval` tools |
| TinyFish rejects private IPs / localhost | Fetch API enforces server-side |
| Studio + API behind login | `SimpleAuth` on `server.auth` |
| Role-based UI + route permissions | `StaticRBACProvider` + `DEFAULT_ROLES` |
| Destructive actions gated by role | RBAC hides delete/write actions for lower roles |
| Long-lived host for scheduler | Deploy to a persistent process, not serverless |
| Secrets in `.env`, never committed | `.gitignore` must include `.env`, `workspace/`, and the local store (`mastra.db`, `*.db`, `*.db-*`) |

---

## 10. Success Metrics

- Agent can complete a file round-trip (create, read, edit, grep) end-to-end.
- Agent can run `bun test` via approved shell command and report results.
- Agent answers a factual question using TinyFish search, then summarizes a result page using TinyFish fetch.
- Agent navigates a JS-heavy page via AgentBrowser and extracts structured data.
- Agent remembers a user preference across two separate Discord sessions.
- Agent pursues a `!goal` objective across multiple iterations until the judge marks it done.
- A new skill dropped into `./skills` is discovered and usable without code changes.
- A scheduled workflow (`daily-digest`) fires on its cron, runs, and shows a `success` run in Studio's `/workflows/schedules` view; pausing it stops further fires.
- An unauthenticated request to Studio or `/api/agents/*` is rejected; a valid token grants access scoped to the user's role (e.g. viewer cannot delete, admin can).

---

## 11. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Foundation** | `assistant` (general-purpose agent) with opencode-go model, memory, workspace (fs+sandbox), safety config; remove existing `weatherAgent`/`weatherWorkflow`/weather scorers. | Agent reads/writes files and runs approved shell commands in Studio. |
| **P1 — Web tools** | TinyFish search + fetch tools; `research` skill. | Agent answers live-web questions and fetches pages. |
| **P2 — Browser** | AgentBrowser attached; screencast in Studio. | Agent automates a login-free page flow. |
| **P3 — Discord** | Discord adapter, webhooks, tool-approval cards, tunnel guide. | Agent responds to a Discord mention with an approved tool call. |
| **P4 — Goals & skills** | Goals config, `!goal` wiring, `engineering` skill, BM25 + LSP on. | Agent completes a multi-iteration goal and loads a skill on demand. |
| **P5 — Auth & scheduling** | SimpleAuth + StaticRBACProvider, seeded users/roles; `daily-digest` scheduled workflow; Studio login verified. | Studio is login-gated; scheduled workflow fires and is pausable; roles enforced. |
| **P6 — Hardening** | Observability review, rate-limit handling for TinyFish, error UX, docs. | Stable run under mixed workload. |

---

## 12. Open Questions

1. **Headless default**: ship browser headless (`true`) for servers, or headed (`false`) for local dev visibility?
2. **Discord approval UX**: render tool calls as interactive cards (default) or plain text? Cards are recommended.
3. **Skill authoring**: should operators add skills via the workspace filesystem only, or also via a managed/external package source?
4. **Storage**: keep DuckDB observability domain, or simplify to LibSQL-only for v1?
5. **Auth provider**: start with `SimpleAuth` (token map, free, dev-friendly) or go straight to a third-party provider (Clerk/WorkOS) for production SSO? SimpleAuth is recommended for v1.
6. **Scheduler cadence**: single daily digest, or multiple scheduled workflows (e.g. hourly web sweeps, weekly summaries)?

---

## 13. References

- Mastra Channels: https://mastra.ai/docs/agents/channels
- Mastra Goals: https://mastra.ai/docs/agents/goals
- Mastra Workspace: https://mastra.ai/docs/workspace/overview
- Mastra Workspace Skills: https://mastra.ai/docs/workspace/skills
- Mastra Browser: https://mastra.ai/docs/browser/overview
- TinyFish Search API: https://docs.tinyfish.ai/search-api/reference
- TinyFish Fetch API: https://docs.tinyfish.ai/fetch-api/reference
- Mastra Scheduled Workflows: https://mastra.ai/docs/workflows/scheduled-workflows
- Mastra Studio Auth: https://mastra.ai/docs/studio/auth
- Mastra Auth overview: https://mastra.ai/docs/server/auth
- OpenCode Go provider: confirmed in `@mastra/core` provider registry (13 models)
- Chat SDK Discord adapter: https://chat-sdk.dev/adapters/discord
