import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { PROJECT_ROOT } from "../paths";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

const digestStep = createStep({
    id: "generate-digest",
    inputSchema: z.object({
        topic: z.string().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        path: z.string().optional(),
    }),
    execute: async ({ inputData, mastra }) => {
        const topic = inputData.topic ?? "technology news";
        const today = new Date().toISOString().split("T")[0];
        const agent = mastra.getAgent("assistant");

        const result = await agent.generate(
            `Search for the latest ${topic} today (${today}). Summarize the top 5 stories with titles, sources, and one-sentence descriptions. Format as markdown.`,
            {
                memory: {
                    thread: `digest-${today}`,
                    resource: "workflow",
                },
            },
        );

        const digestDir = join(PROJECT_ROOT, "workspace");
        await mkdir(digestDir, { recursive: true });
        const filePath = join(digestDir, `digest-${today}.md`);
        await writeFile(filePath, result.text, "utf-8");

        return { ok: true, path: filePath };
    },
});

export const dailyDigest = createWorkflow({
    id: "daily-digest",
    inputSchema: z.object({
        topic: z.string().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        path: z.string().optional(),
    }),
    schedule: {
        cron: "0 9 * * *",
        timezone: process.env.AGENT_TIMEZONE ?? "Europe/Bucharest",
        inputData: { topic: "technology news" },
    },
})
    .then(digestStep)
    .commit();
