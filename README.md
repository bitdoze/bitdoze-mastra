# mastra-app

A general-purpose agentic coding and research assistant built on the
[Mastra](https://mastra.ai/) framework. A single `assistant` agent that can
read/write files, run shell commands, search and fetch the live web, automate
browsers, chat on Discord, pursue durable goals, run on schedules, persist
memory across sessions, and stay date/time aware.

> Status: Phases 0-5 from the PRD are implemented (foundation, web tools,
> browser, Discord, goals/skills, auth/scheduling). Hardening remains.
> See `PRD.md` and `IMPLEMENTATION_TODO.md`.

## What the assistant can do

- **Files & shell** — read, write, edit, grep, and list files in a local
  workspace, and run approved shell commands (files written are immediately
  executable in the sandbox).
- **Live web** — search the web with TinyFish (`tinyfish_search`) and fetch
  clean readable content from up to 10 URLs (`tinyfish_fetch`).
- **Browser automation** — navigate JS-rendered pages, click elements, type
  text, scroll, take snapshots, and extract structured data with a local
  Playwright-based browser (16 browser tools, live screencast in Studio).
- **Discord** — chat with the bot via DM or @mention in servers. Live streaming
  (text appears as it generates), context-aware typing status ("is searching the
  web", "is reading a file"), tool approval cards, image support, and multi-user
  memory isolation.
- **Memory across sessions** — resource-scoped **working memory** (a persistent
  Markdown scratchpad of user facts and session state) plus **semantic recall**
  over past messages via a local embedder.
- **Date/time aware** — the current date and time is injected into the system
  prompt on every call (always fresh, timezone configurable).
- **CMS-style editing** — modify the agent's instructions and tools at runtime
  through the [Mastra Editor](https://mastra.ai/docs/editor/overview) in Studio,
  with draft/publish/archived versioning stored in the DB.

## Tech stack

- **Runtime:** [Bun](https://bun.com/) (`bun run dev | build | start`)
- **Framework:** [Mastra](https://mastra.ai/) (`@mastra/core` + memory, libsql,
  duckdb, evals, loggers, observability, editor, agent-browser)
- **Model:** `opencode-go/glm-5.2` via the OpenCode Go gateway (configurable
  with `AGENT_MODEL`)
- **Web:** `@tiny-fish/sdk` (search + fetch)
- **Browser:** `@mastra/agent-browser` (local Playwright, thread-scoped)
- **Discord:** `@chat-adapter/discord` (Gateway WebSocket, streaming, typing status)
- **Memory embeddings:** `@mastra/fastembed` (local bge-small-en-v1.5 via ONNX
  Runtime, no embedding API key needed)
- **Storage:** composite LibSQL (default) + DuckDB (observability)
- **Auth:** `SimpleAuth` (token-based, non-EE route authorization via `authorizeUser`)

## Prerequisites

- [Bun](https://bun.com/) installed
- An **OpenCode Go** API key (`OPENCODE_API_KEY`) — the model gateway
- A **TinyFish** API key (`TINYFISH_API_KEY`) — for web search/fetch
- **Chromium** (only if you use browser automation; run `npx playwright-core install chromium`
  after `bun install`)
- **Discord bot credentials** (`DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`,
  `DISCORD_APPLICATION_ID`) from the
  [Discord Developer Portal](https://discord.com/developers/applications)
- **Auth tokens** (`ADMIN_API_KEY`, optionally `MEMBER_API_KEY`) for Studio
  login and API access

## Setup

1. Install dependencies:

   ```shell
   bun install
   ```

2. Copy `.env.example` to `.env` and fill in your keys:

   ```shell
   cp .env.example .env
   ```

   ```shell
   OPENCODE_API_KEY=your-opencode-api-key
   TINYFISH_API_KEY=sk-tinyfish-your-key
   DISCORD_PUBLIC_KEY=your-discord-public-key
   DISCORD_APPLICATION_ID=your-discord-application-id
   DISCORD_BOT_TOKEN=your-discord-bot-token
   ADMIN_API_KEY=your-admin-token
   # Optional overrides (defaults shown):
   # AGENT_MODEL=opencode-go/glm-5.2
   # AGENT_JUDGE_MODEL=opencode-go/glm-5.1
   # AGENT_TIMEZONE=Europe/Bucharest
   # DATABASE_URL=file:./mastra.db
   # ALLOWED_DIRECTORIES=/home/me/projects/app-a:/home/me/projects/app-b
   # REQUIRE_COMMAND_APPROVAL=true      # set false to skip command approvals
   # MASTRA_AUTO_DETECT_URL=true        # set true behind a reverse proxy
   ```

   > No embedding API key is required. Semantic recall runs locally via
   > `@mastra/fastembed`; the model downloads on first use.

## Run

Start the development server:

```shell
bun run dev
```

Open [http://localhost:4111](http://localhost:4111) for
[Mastra Studio](https://mastra.ai/docs/studio/overview), where you can chat
with the `assistant` agent, inspect traces, and browse the workspace and skills.
Studio requires authentication — pass your token via
`http://localhost:4111/?auth_header=Bearer%20your-admin-token` or enter it on
the login screen.
The REST API is served under `/api` (e.g. `/api/agents/assistant`). All routes
require an `Authorization: Bearer <token>` header.

Other scripts:

```shell
bun run build   # bundle into .mastra/output
bun run start   # run the built server
```

## Deployment

This app runs on the host (not containerized) so the agent has real access to the
filesystem and shell. It is managed as a **systemd user service** and exposed
through an existing **Caddy** reverse proxy.

### Build, then run the bundle

```shell
bun run build   # produces .mastra/output (self-contained Node server)
```

The production entry point is `node .mastra/output/index.mjs` with
`MASTRA_STUDIO_PATH=$(pwd)/.mastra/output/studio`. It binds `0.0.0.0:4111`.

### systemd user service

Example unit at `~/.config/systemd/user/mastra-app.service`:

```ini
[Unit]
Description=Mastra App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/dragos/projects/mastra-app
EnvironmentFile=/home/dragos/projects/mastra-app/.env
Environment=MASTRA_STUDIO_PATH=/home/dragos/projects/mastra-app/.mastra/output/studio
Environment=NODE_ENV=production
Environment="PATH=/home/dragos/.bun/bin:/home/dragos/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/bin/node /home/dragos/projects/mastra-app/.mastra/output/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Manage it with:

```shell
systemctl --user daemon-reload
systemctl --user enable --now mastra-app
systemctl --user status | restart | stop mastra-app
journalctl --user -u mastra-app -f        # live logs
```

Lingering must be on so the service survives SSH disconnect:
`sudo loginctl enable-linger dragos`.

### Caddy reverse proxy

Caddy runs in Docker (external `web` network) and proxies the host service.
Add to the Caddyfile (`/home/dragos/docker-apps/caddy/Caddyfile`):

```caddy
chat.ai.bitdoze.com {
    reverse_proxy host.docker.internal:4111
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
    }
}
```

Reload with `sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
A wildcard `*.ai.bitdoze.com` DNS record lets Caddy auto-issue the TLS cert.

### Behind a reverse proxy

Set `MASTRA_AUTO_DETECT_URL=true` in `.env` so the Studio SPA uses the browser's
origin (`https://chat.ai.bitdoze.com`) for API calls instead of the literal
`0.0.0.0:4111` server address, which is unreachable from browsers. Without it,
Studio fails to load ("Unexpected token '<' ... is not valid JSON").

### Redeploying after code changes

```shell
cd /home/dragos/projects/mastra-app && bun run build && systemctl --user restart mastra-app
```

## Project structure

```
src/mastra/
  index.ts                  # Mastra instance: agent, workflow, storage, auth, observability, editor
  agents/
    assistant.ts            # the general-purpose agent (model, tools, memory, workspace, browser, goals, Discord)
  tools/
    tinyfish-client.ts      # shared @tiny-fish/sdk client
    tinyfish-search.ts      # web search tool
    tinyfish-fetch.ts       # clean-content fetch tool
  workflows/
    daily-digest.ts         # scheduled workflow: web search -> digest -> workspace markdown
  memory.ts                 # Memory: semantic recall + resource-scoped working memory
  workspaces.ts             # Workspace: local filesystem + sandbox + BM25 + auto-discovered skills
  browsers.ts               # AgentBrowser: local Playwright, thread-scoped, optional CDP
  auth.ts                   # SimpleAuth (token auth + non-EE route authorization)
  paths.ts                  # absolute project-root path resolution (dev/prod consistent)
skills/
  research/SKILL.md         # search -> fetch -> synthesize workflow skill
  engineering/SKILL.md      # lint -> type-check -> test -> build workflow skill
workspace/                  # agent filesystem + sandbox working dir (gitignored)
```

## Key design notes

- **Single agent.** The weather example agent/workflow/scorers shipped with the
  scaffold were removed. There is one general-purpose agent, `assistant`.
- **Absolute path resolution.** `mastra dev` runs the bundled server with its
  working directory under `src/mastra/public/`, so relative paths (workspace,
  storage DBs, skills) are unreliable. `paths.ts` anchors all resource paths to
  the project root derived from `import.meta.url`, so they resolve identically
  in `mastra dev`, `mastra start`, and standalone `node .mastra/output/index.mjs`.
- **Safety rails (workspace).** Writes require approval and read-before-write;
  the delete tool is disabled; `execute_command` caps output tokens. Sensitive
  data is redacted in observability traces. Two env vars tune this:
  `ALLOWED_DIRECTORIES` (colon-separated absolute paths) grants the file tools
  read/write access to additional projects outside `./workspace` (containment
  stays on), and `REQUIRE_COMMAND_APPROVAL=false` skips the command-approval
  prompt for trusted local setups.
- **Dynamic system prompt.** `instructions` is a function resolved on each call
  so the injected current date/time is always accurate.
- **Local embeddings.** Semantic recall uses `@mastra/fastembed` (CPU, free, no
  API key). To switch to hosted embeddings, swap the `embedder` in `memory.ts`
  for `new ModelRouterEmbeddingModel('openai/text-embedding-3-small')` and add an
  embedding provider key.
- **Mastra Editor.** The agent's instructions and tools are editable at runtime
  through Studio (Agents > assistant > Editor tab). Saves create versioned drafts
  (draft/publish/archived) stored in the DB (`db` source). The agent constructor
  does not set an `editor` field, so both instructions and tools are editable by
  default; set `editor: false` to lock the agent or `editor: { instructions: true }`
  to allow only prompt edits.
- **Browser (thread-scoped).** Each conversation thread gets its own isolated
  browser instance. The `BrowserConfig` type is a discriminated union: local
  launches use `scope: 'thread'`, CDP connections use `scope: 'shared'`. Set
  `BROWSER_HEADLESS=false` for a visible window or `BROWSER_CDP_URL` to connect
  to an external browser. Screencast streams live to Studio via WebSocket
  (`ws` + `@hono/node-ws`).
- **Discord (Gateway mode).** The bot connects via persistent Gateway WebSocket
  on boot, so it receives DMs and @mentions without a public webhook URL. Text
  streams live (post then edit). A custom `typingStatus` function maps each tool
  to a human-readable label ("is searching the web", "is reading a file",
  "is opening a website"). Tool calls render as concise text; approval-required
  tools still show interactive Approve/Deny cards. Images shared in Discord are
  sent inline so the agent can see them. On first mention in a thread, the last
  10 messages are fetched for context. Each user gets isolated memory scoped as
  `discord:<userId>`.
- **Durable goals.** Setting `goal: { judge, maxRuns }` on the agent enables
  the goal system. An objective set via `agent.setObjective(objective, {threadId,
  resourceId})` is persisted in thread state and judged each iteration by a
  separate LLM (the judge model). The objective is projected as
  `<current-objective>` into the model's context automatically. Custom REST
  routes at `/objective/:agentId` (GET/POST/DELETE) and
  `/objective/:agentId/options` (PATCH) expose goal management over HTTP.
- **Scheduled workflows.** The `daily-digest` workflow declares a `schedule`
  with `cron: "0 9 * * *"`. On boot, Mastra auto-registers it. It runs the
  agent over a web-search prompt and writes a Markdown digest to
  `workspace/digest-<date>.md`. Pause and resume from Studio's Schedules view
  or the API.
- **Auth.** `SimpleAuth` maps tokens to users (loaded from
  `ADMIN_API_KEY` / `MEMBER_API_KEY`) and gates both Studio and all `/api/*`
  routes. Route-level authorization is handled by `authorizeUser` (non-EE):
  schedule pause/resume is restricted to `admin`. No `StaticRBACProvider`
  (that lives under the enterprise `/ee` path and is intentionally not used).
  Without a valid token, all routes return 401. Studio shows a login screen;
  pass the token via `?auth_header=Bearer%20<token>` for embedding. If no token
  is configured, the server warns at startup and stays inaccessible.

## Roadmap

Implemented (Phase 0 through Phase 5):

- General-purpose `assistant` agent on the OpenCode Go gateway
- Local workspace (filesystem + sandbox) with safety rails and BM25 search
- TinyFish web search and fetch tools, with `research` and `engineering` skills
- Browser automation via AgentBrowser (16 tools, JS-rendered pages, Studio screencast)
- Discord channel (Gateway WebSocket, streaming, custom typing status, tool approvals)
- Durable goals with LLM judge (setObjective, custom REST routes)
- Scheduled daily-digest workflow (web search, workspace write, Discord posting)
- Auth (SimpleAuth) with non-EE route authorization (admin/member roles)
- Resource-scoped working memory and semantic recall (local embeddings)
- Current date/time in the system prompt (ISO + year reinforced for web searches)
- Composite storage (LibSQL + DuckDB observability) with sensitive-data redaction
- Mastra Editor for CMS-style agent editing (instructions + tools, versioned)

Planned (see `PRD.md` / `IMPLEMENTATION_TODO.md`):

- Hardening (Phase 6)

## Learn more

- [Mastra documentation](https://mastra.ai/docs/)
- [TinyFish API reference](https://docs.tinyfish.ai/)
