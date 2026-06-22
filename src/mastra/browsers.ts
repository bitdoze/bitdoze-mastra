import { AgentBrowser } from "@mastra/agent-browser";

// Headless by default. Set BROWSER_HEADLESS=false in .env for a visible window.
const headless = process.env.BROWSER_HEADLESS !== "false";

// Optional CDP URL to connect to an existing browser (e.g., hosted Chrome).
// When set, scope auto-falls-back to 'shared'.
const cdpUrl = process.env.BROWSER_CDP_URL;

export const browser = new AgentBrowser(
    cdpUrl
        ? { headless, cdpUrl, scope: "shared" }
        : { headless, scope: "thread" },
);
