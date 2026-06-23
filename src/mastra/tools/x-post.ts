import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";

// Posts a tweet using OAuth 2.0 user context (PKCE). Requires the X Developer
// app configured with OAuth 2.0 and the tweet.read + tweet.write + users.read
// scopes. The access token is short-lived; the tool refreshes it on demand
// using the refresh token + client id (client secret only for confidential
// apps — this assumes a public PKCE client).
const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET; // optional (confidential apps)
const ACCESS_TOKEN = process.env.X_OAUTH2_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.X_OAUTH2_REFRESH_TOKEN;

interface TokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshAccessToken(): Promise<TokenResult | null> {
  if (!CLIENT_ID || !REFRESH_TOKEN) return null;
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
    });
    if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);

    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResult;
  } catch {
    return null;
  }
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
    if (!ACCESS_TOKEN) {
      return {
        success: false,
        error:
          "X_OAUTH2_ACCESS_TOKEN is not configured. Set X_CLIENT_ID, X_OAUTH2_ACCESS_TOKEN, and X_OAUTH2_REFRESH_TOKEN in .env.",
      };
    }

    let token = ACCESS_TOKEN;
    const post = async (tok: string) => {
      const client = new TwitterApi(tok);
      return client.v2.tweet(input.text);
    };

    try {
      let { data, errors } = await post(token);

      // On auth failure, try refreshing the token once and retry.
      const isAuthError = (e?: any) =>
        e?.code === 401 || e?.code === 32 || /token|auth/i.test(e?.title ?? e?.detail ?? "");
      if (errors?.some(isAuthError) || (data === undefined && errors?.some(isAuthError))) {
        const refreshed = await refreshAccessToken();
        if (refreshed?.access_token) {
          token = refreshed.access_token;
          const retry = await post(token);
          data = retry.data;
          errors = retry.errors;
        }
      }

      if (errors && errors.length > 0) {
        return {
          success: false,
          error: errors
            .map((e: any) => e.detail ?? e.title ?? JSON.stringify(e))
            .join("; "),
        };
      }

      const tweetId = data?.id;
      const username = await new TwitterApi(token)
        .currentUser()
        .then((u) => u.screen_name)
        .catch(() => null);

      return {
        success: true,
        tweetId,
        url: tweetId && username ? `https://twitter.com/${username}/status/${tweetId}` : undefined,
      };
    } catch (error: any) {
      const code = error?.code;
      const detail =
        error?.data?.detail ||
        error?.detail ||
        error?.message ||
        (code ? `X API error ${code}` : "Unknown error");
      return { success: false, error: `Failed to post tweet: ${detail}` };
    }
  },
});
