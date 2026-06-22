import { TinyFish } from "@tiny-fish/sdk";

// Shared client. Reads TINYFISH_API_KEY from env. Auto-retries 429/5xx with
// exponential backoff. Reused by search, fetch, and (later) agent/browser tools.
export function getTinyFish(): TinyFish {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TINYFISH_API_KEY is not set. Add it to .env to enable TinyFish tools.",
    );
  }
  return new TinyFish({ apiKey });
}
