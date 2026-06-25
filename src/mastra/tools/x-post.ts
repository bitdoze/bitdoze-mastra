import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";

// Posts a tweet using OAuth 1.0a user context. Requires the X Developer app
// configured with Read+Write permissions and four credentials: the app's
// consumer key/secret (API Key/Secret) plus the user's access token/secret.
// OAuth 1.0a tokens do not expire, so no refresh flow is needed.
const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_SECRET = process.env.X_ACCESS_SECRET;

function getClient(): TwitterApi | null {
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_SECRET) return null;
  return new TwitterApi({
    appKey: API_KEY,
    appSecret: API_SECRET,
    accessToken: ACCESS_TOKEN,
    accessSecret: ACCESS_SECRET,
  });
}

export const postTweet = createTool({
  id: "post_tweet",
  description:
    "Post a tweet (max 280 characters) to the connected X/Twitter account. Use for sharing updates, blog post links, or video links. External action — the tweet is published immediately.",
  inputSchema: z.object({
    text: z.string().max(280).describe("Tweet text, max 280 characters"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tweetId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const client = getClient();
    if (!client) {
      return {
        success: false,
        error:
          "X OAuth 1.0a credentials are not configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_SECRET in .env.",
      };
    }

    try {
      const { data, errors } = await client.v2.tweet(input.text);

      if (errors && errors.length > 0) {
        return {
          success: false,
          error: errors
            .map((e: any) => e.detail ?? e.title ?? JSON.stringify(e))
            .join("; "),
        };
      }

      const tweetId = data?.id;
      const username = await client
        .currentUser()
        .then((u) => u.screen_name)
        .catch(() => null);

      return {
        success: true,
        tweetId,
        url:
          tweetId && username
            ? `https://twitter.com/${username}/status/${tweetId}`
            : undefined,
      };
    } catch (error: any) {
      const code = error?.code;
      const detail =
        error?.data?.detail ||
        error?.data?.errors?.[0]?.message ||
        error?.detail ||
        error?.message ||
        (code ? `X API error ${code}` : "Unknown error");
      return { success: false, error: `Failed to post tweet: ${detail}` };
    }
  },
});
