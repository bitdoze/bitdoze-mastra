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
                `You are a daily tech news curator. Today is ${today}. Research and compile a comprehensive daily digest using web search and the github_trending_repos tool. Cover these sections:

## 1. AI News (top 5)
Search for the latest AI developments from the last 24-48 hours. Focus on: new model releases, benchmark results, open-source AI tools, AI agents, local AI, regulation, and research breakthroughs. For each: title, source link, and 2-3 sentences of real substance (not fluff).

## 2. Developer & DevOps News (top 5)
Search for news in: Docker, Kubernetes, CI/CD, cloud (AWS/GCP/Azure/Hetzner/Bunny), infrastructure-as-code, observability, terminal/CLI tools, and developer experience. For each: title, source link, and why it matters to a developer.

## 3. Self-Hosting & Homelab (top 3-4)
Search for new self-hosted apps, Docker containers, home server builds, and networking tools trending today. For each: name, GitHub or project link, and what it does.

## 4. Trending GitHub Repositories (top 10)
Use the github_trending_repos tool to find trending repos from the last 7 days. Pick the 10 most interesting across AI, developer tools, CLI utilities, self-hosting, and open source. For each: repo name with link, one-line description, language, and star count.

## 5. Hacker News Top Stories (top 5)
Search for today's top Hacker News stories. For each: title, link, points, and a brief description.

## 6. Reddit Highlights (top 5)
Search Reddit for trending posts from: r/MachineLearning, r/selfhosted, r/devops, r/programming, r/docker, rLocalLLaMA, r/homelab. Pick the 5 most interesting or discussed posts. For each: subreddit, title, link, and why it's noteworthy.

## 7. Articles to Write for bitdoze.com (3-5 ideas)
Based on everything you found today, suggest 3-5 article ideas for bitdoze.com (covers: AI tools, self-hosting, Docker, VPS, CDN, developer tooling, Mac/Linux setup). For each idea: a compelling title, a 1-2 sentence pitch on what the article would cover and why it's timely, and the target audience. Prioritize topics that are trending but don't yet have good tutorials or guides.

Format everything as clean markdown with clear section headers, bullet points, and links. Be specific and factual — no filler or hype. If you couldn't find something for a section, say so rather than guessing.`,
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
            topic: "AI news, DevOps news, self-hosting, trending GitHub repos, Hacker News, Reddit highlights, article ideas for bitdoze.com",
        },
    },
})
    .then(digestStep)
    .then(notifyStep)
    .commit();
