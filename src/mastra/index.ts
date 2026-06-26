import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import {
    Observability,
    MastraStorageExporter,
    MastraPlatformExporter,
    SensitiveDataFilter,
} from "@mastra/observability";
import { MastraEditor } from "@mastra/editor";
import { assistant } from "./agents/assistant";
import { youtubeMaster } from "./agents/youtube-master";
import { videoCreator } from "./agents/video-creator";
import { auth } from "./auth";
import { dailyDigest } from "./workflows/daily-digest";
import { DATABASE_URL, DUCKDB_PATH } from "./paths";

export const mastra = new Mastra({
    agents: { assistant, youtubeMaster, videoCreator },
    workflows: { dailyDigest },
    editor: new MastraEditor(),
    storage: new MastraCompositeStore({
        id: "composite-storage",
        default: new LibSQLStore({
            id: "mastra-storage",
            url: DATABASE_URL,
        }),
        domains: {
            observability: await new DuckDBStore({
                path: DUCKDB_PATH,
            }).getStore("observability"),
        },
    }),
    logger: new PinoLogger({
        name: "Mastra",
        level: "info",
    }),
    server: {
        host: "0.0.0.0",
        port: 4111,
        auth,
        apiRoutes: [
            // Set a durable objective for a thread (goal feature)
            registerApiRoute("/objective/:agentId", {
                method: "POST",
                handler: async (c) => {
                    const mastra = c.get("mastra");
                    const agentId = c.req.param("agentId");
                    const agent = mastra.getAgent(agentId);
                    const {
                        objective,
                        threadId,
                        resourceId,
                        maxRuns,
                        judgeModelId,
                    } = await c.req.json();
                    if (!objective || !threadId) {
                        return c.json(
                            { error: "objective and threadId required" },
                            400,
                        );
                    }
                    const record = await agent.setObjective(objective, {
                        threadId,
                        resourceId,
                        ...(maxRuns ? { maxRuns } : {}),
                        ...(judgeModelId ? { judgeModelId } : {}),
                    });
                    return c.json({ record });
                },
            }),
            // Get the current objective for a thread
            registerApiRoute("/objective/:agentId", {
                method: "GET",
                handler: async (c) => {
                    const mastra = c.get("mastra");
                    const agentId = c.req.param("agentId");
                    const agent = mastra.getAgent(agentId);
                    const threadId = c.req.query("threadId");
                    if (!threadId) {
                        return c.json({ error: "threadId required" }, 400);
                    }
                    const record = await agent.getObjective({ threadId });
                    return c.json({ record });
                },
            }),
            // Clear the objective for a thread
            registerApiRoute("/objective/:agentId", {
                method: "DELETE",
                handler: async (c) => {
                    const mastra = c.get("mastra");
                    const agentId = c.req.param("agentId");
                    const agent = mastra.getAgent(agentId);
                    const threadId = c.req.query("threadId");
                    if (!threadId) {
                        return c.json({ error: "threadId required" }, 400);
                    }
                    await agent.clearObjective({ threadId });
                    return c.json({ cleared: true });
                },
            }),
            // Update objective options (e.g. raise maxRuns)
            registerApiRoute("/objective/:agentId/options", {
                method: "PATCH",
                handler: async (c) => {
                    const mastra = c.get("mastra");
                    const agentId = c.req.param("agentId");
                    const agent = mastra.getAgent(agentId);
                    const { threadId, maxRuns, judgeModelId, prompt } =
                        await c.req.json();
                    if (!threadId) {
                        return c.json({ error: "threadId required" }, 400);
                    }
                    const record = await agent.updateObjectiveOptions({
                        threadId,
                        ...(maxRuns ? { maxRuns } : {}),
                        ...(judgeModelId ? { judgeModelId } : {}),
                        ...(prompt ? { prompt } : {}),
                    });
                    return c.json({ record });
                },
            }),
        ],
    },
    observability: new Observability({
        configs: {
            default: {
                serviceName: "mastra",
                exporters: [
                    new MastraStorageExporter(), // Persists observability events to Mastra Storage
                    new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
                ],
                spanOutputProcessors: [
                    new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
                ],
            },
        },
    }),
});
