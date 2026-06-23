import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { extractVideoId, formatTimestamp, fetchWatchHtml, extractPlayerResponse } from "./youtube-utils";

// Fetches metadata (title, author, description, duration) by parsing the
// public YouTube watch page's ytInitialPlayerResponse. No API key required.
export const youtubeMetadata = createTool({
  id: "fetch-youtube-metadata",
  description:
    "Fetches metadata (title, author/channel, description, duration) for a YouTube video. Use this to understand the video context before or instead of fetching the full transcript.",
  inputSchema: z.object({
    url: z.string().describe("YouTube video URL or video ID"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the metadata fetch was successful"),
    videoId: z.string().optional().describe("The 11-character YouTube video ID"),
    title: z.string().optional().describe("The video title"),
    author: z.string().optional().describe("The channel/author name"),
    description: z.string().optional().describe("The video description"),
    durationSeconds: z.number().optional().describe("Video duration in seconds"),
    durationFormatted: z
      .string()
      .optional()
      .describe("Video duration in MM:SS or HH:MM:SS format"),
    error: z.string().optional().describe("Error message if the fetch failed"),
  }),
  execute: async (input) => {
    const videoId = extractVideoId(input.url);

    if (!videoId) {
      return {
        success: false,
        error: "Invalid YouTube URL or video ID.",
      };
    }

    try {
      const html = await fetchWatchHtml(videoId);
      const playerData = extractPlayerResponse(html);

      const videoDetails = playerData?.videoDetails;
      if (!videoDetails) {
        return {
          success: false,
          videoId,
          error: "Video details not found. The video may be unavailable, private, or age-restricted.",
        };
      }

      const durationSeconds = parseInt(videoDetails.lengthSeconds, 10) || 0;

      return {
        success: true,
        videoId,
        title: videoDetails.title || "",
        author: videoDetails.author || "",
        description: videoDetails.shortDescription || "",
        durationSeconds,
        durationFormatted: formatTimestamp(durationSeconds),
      };
    } catch (error) {
      return {
        success: false,
        videoId,
        error: `Failed to fetch metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
