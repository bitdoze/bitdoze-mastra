import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Posts a skeet to Bluesky via the AT Protocol XRPC endpoints using an
// app password (handle + password). No SDK required: two REST calls —
// createSession to authenticate, then repo.createRecord to publish the post.
//
// Prerequisites (set in .env):
//   BLUESKY_HANDLE   - your account handle, e.g. "yourname.bsky.social"
//   BLUESKY_PASSWORD - an app password from https://bsky.app/settings/app-passwords
//
// Posts are plain text (max 300 chars, Bluesky's limit). The post is published
// immediately and publicly. Sessions are cached in memory; access tokens last
// ~2 hours and are refreshed on expiry or rejection.

const PDS_HOST = process.env.BLUESKY_PDS_HOST ?? "https://bsky.social";
const HANDLE = process.env.BLUESKY_HANDLE;
const PASSWORD = process.env.BLUESKY_PASSWORD;

interface CachedSession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  expiresAt: number;
}

let session: CachedSession | null = null;

class BlueskyError extends Error {}

async function createSession(): Promise<CachedSession> {
  if (!HANDLE || !PASSWORD) {
    throw new BlueskyError(
      "Bluesky credentials are not configured. Set BLUESKY_HANDLE and BLUESKY_PASSWORD in .env.",
    );
  }

  const res = await fetch(
    `${PDS_HOST}/xrpc/com.atproto.server.createSession`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new BlueskyError(
      `Bluesky createSession failed (HTTP ${res.status}): ${text}`,
    );
  }

  const data = (await res.json()) as {
    accessJwt: string;
    refreshJwt: string;
    did: string;
    expireAt?: string;
  };

  return {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    did: data.did,
    // Default to 2h if the server didn't send an expiry.
    expiresAt: data.expireAt
      ? new Date(data.expireAt).getTime()
      : Date.now() + 2 * 60 * 60 * 1000,
  };
}

async function refreshSession(): Promise<CachedSession> {
  if (!session) throw new BlueskyError("No session to refresh.");

  const res = await fetch(
    `${PDS_HOST}/xrpc/com.atproto.server.refreshSession`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.refreshJwt}`,
      },
    },
  );

  if (!res.ok) {
    // Refresh failed (token revoked) — fall back to a fresh login.
    return createSession();
  }

  const data = (await res.json()) as {
    accessJwt: string;
    refreshJwt: string;
    did: string;
    expireAt?: string;
  };

  session = {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    did: data.did,
    expiresAt: data.expireAt
      ? new Date(data.expireAt).getTime()
      : Date.now() + 2 * 60 * 60 * 1000,
  };

  return session;
}

async function getSession(): Promise<CachedSession> {
  if (!session || session.expiresAt <= Date.now()) {
    session = await createSession();
  }
  return session;
}

export const postBluesky = createTool({
  id: "post_bluesky",
  description:
    "Post a skeet (max 300 characters) to the connected Bluesky account. Use for sharing updates, blog post links, or video links. External action — the skeet is published immediately and publicly.",
  inputSchema: z.object({
    text: z
      .string()
      .max(300)
      .describe("Skeet text, max 300 characters"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    uri: z.string().optional(),
    cid: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const s = await getSession();

      const recordBody = {
        repo: s.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text: input.text,
          createdAt: new Date().toISOString(),
        },
      };

      const res = await fetch(
        `${PDS_HOST}/xrpc/com.atproto.repo.createRecord`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.accessJwt}`,
          },
          body: JSON.stringify(recordBody),
        },
      );

      // 401 = access token expired. Refresh once and retry.
      if (res.status === 401 && session) {
        await refreshSession();
        const retry = await fetch(
          `${PDS_HOST}/xrpc/com.atproto.repo.createRecord`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session!.accessJwt}`,
            },
            body: JSON.stringify(recordBody),
          },
        );
        return await parseCreateRecordResponse(retry, s.did, HANDLE);
      }

      return await parseCreateRecordResponse(res, s.did, HANDLE);
    } catch (error: any) {
      const detail =
        error instanceof BlueskyError
          ? error.message
          : (error?.message ?? "Unknown error");
      return { success: false, error: `Failed to post skeet: ${detail}` };
    }
  },
});

async function parseCreateRecordResponse(
  res: Response,
  did: string,
  handle: string | undefined,
): Promise<{
  success: boolean;
  uri?: string;
  cid?: string;
  url?: string;
  error?: string;
}> {
  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      error: `Bluesky createRecord failed (HTTP ${res.status}): ${text}`,
    };
  }

  const data = (await res.json()) as { uri: string; cid: string };

  // uri looks like: at://did:plc:abc/app.bsky.feed.post/rkey
  const rkey = data.uri.split("/").pop();
  const handleOrDid = handle ?? did;
  const url = rkey ? `https://bsky.app/profile/${handleOrDid}/post/${rkey}` : undefined;

  return {
    success: true,
    uri: data.uri,
    cid: data.cid,
    url,
  };
}
