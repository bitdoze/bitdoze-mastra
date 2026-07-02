import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolve, isAbsolute, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  MINIMAX_API_BASE,
  getMinimaxApiKey,
  DEFAULT_VOICE_ID,
  MinimaxApiError,
} from "./minimax-client";
import { WORKSPACE_PATH } from "../paths";

// MiniMax Text-to-Audio (T2A v2) tool. Synthesises speech from text using a
// cloned voice (default: "dragos") and writes the audio file directly to disk
// so the video-creator agent can drop it into a HyperFrames composition.
//
// Defaults are tuned for a CLEAR, NATURAL, DELIBERATE delivery: fluent emotion,
// normal speed (1.0), no intensity boost. Reads at a comfortable pace so viewers
// can absorb each point — videos were previously too fast/rushed.

export const minimaxTts = createTool({
  id: "minimax_tts",
  description:
    "Generate narration audio from text using MiniMax TTS with the cloned dragos voice (moss_audio_e59d7416-737a-11f1-8b87-ba0ad3e185a0). Writes a wav/mp3 file to disk and returns the path + audio metadata. Use this for video voiceovers — generate BEFORE building the composition so the timeline can be sized to the audio. Natural, deliberate pace by default — do NOT speed it up; videos that feel rushed are the #1 quality issue.",
  inputSchema: z.object({
    text: z
      .string()
      .max(10000)
      .describe(
        "The narration text to convert to speech. Max 10,000 characters. Use newlines for paragraph breaks. Supports interjection tags like (laughs), (breath), (sighs) with speech-2.8 models. Use <#x#> for custom pauses (x = seconds).",
      ),
    outputPath: z
      .string()
      .describe(
        "Path to save the audio file. Relative paths resolve against the workspace root. Extension must match the format (.wav, .mp3, .flac).",
      ),
    speed: z
      .number()
      .min(0.5)
      .max(2)
      .optional()
      .describe(
        "Speech speed. 1.0 = normal. Default 1.0 — keep narration at a natural, deliberate pace. Only raise above 1.0 if the user explicitly asks for a fast/upbeat read.",
      ),
    emotion: z
      .enum([
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "calm",
        "fluent",
      ])
      .optional()
      .describe(
        "Emotion for the synthesized speech. Default 'fluent' — a natural, even narration tone. Avoid 'happy' for informational/technical content (it sounds salesy and rushed).",
      ),
    voiceId: z
      .string()
      .optional()
      .describe(
        "MiniMax voice ID. Defaults to the cloned 'dragos' voice. Override only to use a different system or cloned voice.",
      ),
    model: z
      .enum([
        "speech-2.8-hd",
        "speech-2.8-turbo",
        "speech-2.6-hd",
        "speech-2.6-turbo",
      ])
      .optional()
      .describe(
        "TTS model. 'speech-2.8-hd' (default) is highest quality and supports interjection tags. 'speech-2.8-turbo' is faster.",
      ),
    format: z
      .enum(["wav", "mp3", "flac"])
      .optional()
      .describe(
        "Output audio format. Default 'wav' (required by HyperFrames compositions).",
      ),
    pitch: z
      .number()
      .int()
      .min(-12)
      .max(12)
      .optional()
      .describe("Pitch adjustment, -12 to 12. Default 0."),
    subtitles: z
      .boolean()
      .optional()
      .describe(
        "If true, generate word-level subtitle timestamps (returned as a download URL in the output). Useful for timing animations to narration.",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string().optional(),
    durationMs: z.number().optional(),
    audioFormat: z.string().optional(),
    sampleRate: z.number().optional(),
    charactersBilled: z.number().optional(),
    subtitleFileUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const apiKey = getMinimaxApiKey();
    const format = input.format ?? "wav";
    const model = input.model ?? "speech-2.8-hd";
    const voiceId = input.voiceId ?? DEFAULT_VOICE_ID;
    const speed = input.speed ?? 1.0;
    const emotion = input.emotion ?? "fluent";
    const pitch = input.pitch ?? 0;

    // Resolve output path relative to workspace root.
    const absPath = isAbsolute(input.outputPath)
      ? input.outputPath
      : resolve(WORKSPACE_PATH, input.outputPath);

    // Ensure the parent directory exists.
    try {
      mkdirSync(dirname(absPath), { recursive: true });
    } catch {
      // Directory may already exist; ignore.
    }

    const body = {
      model,
      text: input.text,
      stream: false,
      output_format: "hex",
      language_boost: "auto",
      voice_setting: {
        voice_id: voiceId,
        speed,
        vol: 1,
        pitch,
        emotion,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format,
        channel: 1,
      },
      voice_modify: {
        // No intensity modification — natural delivery. Previous value (-20)
        // pushed the voice toward forceful/rushed reads.
      },
      ...(input.subtitles
        ? { subtitle_enable: true, subtitle_type: "word" as const }
        : {}),
    };

    try {
      const res = await fetch(`${MINIMAX_API_BASE}/v1/t2a_v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      // MiniMax returns HTTP 200 even on logical errors — check base_resp.
      const baseResp = data?.base_resp;
      if (!res.ok || baseResp?.status_code !== 0) {
        const msg =
          baseResp?.status_msg ||
          data?.message ||
          `MiniMax T2A failed (HTTP ${res.status})`;
        throw new MinimaxApiError(
          msg,
          res.status,
          baseResp?.status_code ?? null,
        );
      }

      const hexAudio: string = data?.data?.audio;
      if (!hexAudio) {
        throw new MinimaxApiError(
          "MiniMax T2A returned no audio data.",
          res.status,
        );
      }

      // Decode hex → bytes and write the file.
      const audioBytes = Buffer.from(hexAudio, "hex");
      writeFileSync(absPath, audioBytes);

      return {
        success: true,
        path: absPath,
        durationMs: data?.extra_info?.audio_length,
        audioFormat: data?.extra_info?.audio_format ?? format,
        sampleRate: data?.extra_info?.audio_sample_rate,
        charactersBilled: data?.extra_info?.usage_characters,
        subtitleFileUrl: data?.data?.subtitle_file || undefined,
      };
    } catch (error) {
      if (error instanceof MinimaxApiError) {
        return { success: false, error: error.message };
      }
      return {
        success: false,
        error: `MiniMax TTS failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
