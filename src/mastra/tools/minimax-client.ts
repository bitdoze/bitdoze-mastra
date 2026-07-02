// Shared MiniMax API client. Reads MINIMAX_API_KEY from env.
// Used by the TTS tool (and future MiniMax voice tools).

export const MINIMAX_API_BASE = "https://api.minimax.io";

export function getMinimaxApiKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MINIMAX_API_KEY is not set. Add it to .env to enable MiniMax voice tools.",
    );
  }
  return apiKey;
}

// Default cloned voice ("dragos") created on the MiniMax platform.
// Override per-call or via MINIMAX_VOICE_ID env var.
export const DEFAULT_VOICE_ID =
  process.env.MINIMAX_VOICE_ID ??
  "moss_audio_e59d7416-737a-11f1-8b87-ba0ad3e185a0";

export class MinimaxApiError extends Error {
  status: number;
  // MiniMax internal status code (base_resp.status_code), if available.
  statusCode: number | null;
  constructor(
    message: string,
    status: number,
    statusCode: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.statusCode = statusCode;
  }
}
