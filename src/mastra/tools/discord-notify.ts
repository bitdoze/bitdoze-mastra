import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Posts a notification to a private Discord channel via webhook (no bot token
// needed, fire-and-forget). Set DISCORD_NOTIFY_WEBHOOK in .env. Any agent or
// workflow can call this — useful for surfacing async results (digests, jobs)
// and mid-conversation alerts.
//
// Discord hard limit: 2000 chars per message. This tool chunks longer content
// into multiple sequential posts (title/emoji in the first, remainder after),
// so full digests are delivered without truncation or 400 errors.
const WEBHOOK_URL = process.env.DISCORD_NOTIFY_WEBHOOK;

const COLORS: Record<string, number> = {
  info: 3447003, // blurple
  success: 5763719, // green
  error: 15548997, // red
};

const EMOJI: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  error: "🚨",
};

// Discord's per-message content limit.
const MAX_CONTENT = 2000;

// Split text into chunks <= maxLen, preferring to break on blank lines then
// newlines so messages stay readable (no mid-word/mid-line cuts when possible).
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let slice = remaining.slice(0, maxLen);
    // Try to break at the last blank line, else last newline, else hard cut.
    let breakAt = slice.lastIndexOf("\n\n");
    if (breakAt < maxLen * 0.4) breakAt = slice.lastIndexOf("\n");
    if (breakAt < maxLen * 0.4) breakAt = slice.length;
    chunks.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function postWebhook(body: Record<string, unknown>): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 429 rate limit: respect Retry-After once, then give up on this chunk.
      if (res.status === 429) {
        const data = await res.json().catch(() => null);
        const retryAfterMs = (data?.retry_after ?? 1) * 1000;
        await new Promise((r) => setTimeout(r, retryAfterMs));
        const retry = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return retry.ok;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const discordNotify = createTool({
  id: "discord_notify",
  description:
    "Send a notification message to a private Discord channel via webhook. Use to surface async results, job completion/failure, or alerts. Markdown supported. Long messages are automatically split into multiple posts (Discord's 2000-char limit).",
  inputSchema: z.object({
    message: z.string().describe("Markdown-formatted message to send"),
    title: z.string().optional().describe("Optional bold title for the notification"),
    level: z
      .enum(["info", "success", "error"])
      .default("info")
      .describe("Severity — sets the emoji and embed color."),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    chunks: z.number().describe("Number of messages posted"),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    if (!WEBHOOK_URL) {
      return {
        sent: false,
        chunks: 0,
        error: "DISCORD_NOTIFY_WEBHOOK is not set. Configure it in .env to enable notifications.",
      };
    }

    const level = input.level ?? "info";
    const title = input.title ?? "Notification";
    const header = `${EMOJI[level]} **${title}**`;

    // Reserve room for the header + newline in the first chunk.
    const firstBudget = MAX_CONTENT - header.length - 1;
    const messageChunks = chunkText(input.message, firstBudget);

    // First message carries the header; subsequent messages are plain
    // content (no color-only embed — Discord rejects embeds without a
    // title/description/url/fields).
    const payloads: Record<string, unknown>[] = messageChunks.map((chunk, i) =>
      i === 0 ? { content: `${header}\n${chunk}` } : { content: chunk },
    );

    let sentCount = 0;
    for (const body of payloads) {
      // Small gap to avoid Discord's 5-req/sec webhook rate limit.
      if (sentCount > 0) await new Promise((r) => setTimeout(r, 300));
      if (await postWebhook(body)) sentCount++;
    }

    if (sentCount === 0) {
      return {
        sent: false,
        chunks: 0,
        error: "Discord webhook rejected the message (check webhook URL and permissions).",
      };
    }
    return { sent: true, chunks: sentCount };
  },
});
