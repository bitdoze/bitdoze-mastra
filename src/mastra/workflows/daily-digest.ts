import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { PROJECT_ROOT } from "../paths";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { discordNotify } from "../tools/discord-notify";

// Invoke the notify tool's execute safely (it's typed optional on the tool).
const notify = discordNotify.execute ?? (async () => ({ sent: false }));

const digestStep = createStep({
    id: "generate-digest",
    inputSchema: z.object({
        topic: z.string().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        path: z.string().optional(),
        summary: z.string().optional(),
        error: z.string().optional(),
    }),
    execute: async ({ inputData, mastra }) => {
        const today = new Date().toISOString().split("T")[0];
        const agent = mastra.getAgent("assistant");

        try {
            const result = await agent.generate(
                `You are a daily tech news curator. Today is ${today}. Fetch and compile the following:

1. **AI & Tech News** - Search for the latest AI and technology news from today. Find the top 5 most important stories with titles, sources, and one-sentence descriptions.

2. **Trending GitHub Repos** - Use the github_trending_repos tool to find trending repositories from the last 7 days. Focus on AI, developer tools, and open source projects. List the top 5 with name, description, stars, and language.

3. **Hacker News Top Stories** - Search for today's top Hacker News stories. List the top 5 with titles, points, and brief descriptions.

Format everything as a clean markdown digest with sections for each category. Include links where available.`,
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

            // Full digest text for Discord — the notify tool chunks it past
            // Discord's 2000-char limit so nothing is truncated.
            const summary = result.text;
            return { ok: true, path: filePath, summary };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
});

// Posts the digest (or failure) to a private Discord channel via webhook.
// Runs after the digest step regardless of success; branches on ok/error.
const notifyStep = createStep({
    id: "notify-result",
    inputSchema: z.object({
        ok: z.boolean(),
        path: z.string().optional(),
        summary: z.string().optional(),
        error: z.string().optional(),
    }),
    outputSchema: z.object({
        ok: z.boolean(),
        path: z.string().optional(),
        notified: z.boolean().optional(),
    }),
    execute: async ({ inputData }) => {
        if (inputData.ok) {
            await notify(
                {
                    message:
                        inputData.summary ??
                        `Daily digest ready at \`${inputData.path ?? ""}\``,
                    title: "Daily Digest",
                    level: "success",
                },
                {} as any,
            );
            return { ok: true, path: inputData.path, notified: true };
        }
        await notify(
            {
                message: inputData.error ?? "Unknown error",
                title: "Daily Digest Failed",
                level: "error",
            },
            {} as any,
        );
        return { ok: false, notified: false };
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
        notified: z.boolean().optional(),
    }),
    schedule: {
        cron: "30 7 * * *",
        timezone: process.env.AGENT_TIMEZONE ?? "Europe/Bucharest",
        inputData: {
            topic: "AI and technology news, trending GitHub repos, Hacker News off the day",
        },
    },
})
    .then(digestStep)
    .then(notifyStep)
    .commit();
