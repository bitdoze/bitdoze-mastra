/**
 * Extracts a YouTube video ID from various URL formats.
 * Supports standard watch URLs, short URLs, embed URLs, and raw video IDs.
 */
export function extractVideoId(url: string): string | null {
  // Check if it's already just a video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Formats seconds into MM:SS or HH:MM:SS format.
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

// A current, realistic desktop Chrome UA. YouTube flags older/UAs and serves a
// reduced page (missing video details) to datacenter IPs.
export const YOUTUBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const YOUTUBE_HEADERS: Record<string, string> = {
  "User-Agent": YOUTUBE_UA,
  "Accept-Language": "en-US,en;q=0.9",
};

// Fetches the raw HTML of a video's watch page.
export async function fetchWatchHtml(videoId: string): Promise<string> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: YOUTUBE_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Could not fetch video page (HTTP ${res.status})`);
  }
  return res.text();
}

/**
 * Extracts and parses the full ytInitialPlayerResponse JSON from a watch page.
 *
 * Uses a balanced-brace scan (respecting string literals) instead of a naive
 * non-greedy regex, because the JSON contains `};` sequences inside string
 * values that truncate a regex match before `videoDetails` is reached. YouTube
 * may emit the assignment multiple times; returns the first parsed object that
 * actually contains `videoDetails`.
 */
export function extractPlayerResponse(html: string): any | null {
  const re = /ytInitialPlayerResponse\s*=\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const braceStart = match.index + match[0].lastIndexOf("{");
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > 0) {
      try {
        const parsed = JSON.parse(html.slice(braceStart, end + 1));
        if (parsed?.videoDetails) return parsed;
      } catch {
        // try the next occurrence
      }
    }
  }
  return null;
}

