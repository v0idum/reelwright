import { join } from "node:path";
import type { VoiceoverConfig } from "../domain/schemas.js";
import type { VideoPlan } from "../planning/director.js";

const DEFAULT_PLACEHOLDER_VOICE = "Samantha";
const DEFAULT_LOCAL_TTS_COMMAND = ".venv/bin/mlx_audio.tts.generate";
const DEFAULT_LOCAL_TTS_MODEL = "mlx-community/Kokoro-82M-4bit";
const DEFAULT_LOCAL_TTS_VOICE = "af_heart";
const DEFAULT_LOCAL_TTS_SPEED = 1.05;
const DEFAULT_LOCAL_TTS_LANG_CODE = "a";
const DEFAULT_LOCAL_TTS_AUDIO_FORMAT = "wav";
const DEFAULT_LOCAL_TTS_FILE_PREFIX = "voiceover";
const MAX_SAFE_TEMPO_DELTA = 0.08;

export type LocalTtsVoiceoverInput = {
  text: string;
  outputDirectory: string;
  filePrefix?: string;
  command?: string;
  model?: string;
  voice?: string;
  speed?: number;
  langCode?: string;
  audioFormat?: "wav";
};

export function voiceoverText(plan: VideoPlan): string {
  return [...plan.voiceoverSegments]
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((segment) => segment.text)
    .join("\n\n");
}

export function buildLocalPlaceholderVoiceoverArgs(input: {
  textPath: string;
  outputPath: string;
  voice?: string;
}): { command: string; args: string[] } {
  return {
    command: "/usr/bin/say",
    args: ["-v", input.voice ?? DEFAULT_PLACEHOLDER_VOICE, "-f", input.textPath, "-o", input.outputPath]
  };
}

export function buildLocalTtsVoiceoverArgs(input: LocalTtsVoiceoverInput): { command: string; args: string[] } {
  return {
    command: input.command ?? DEFAULT_LOCAL_TTS_COMMAND,
    args: [
      "--model",
      input.model ?? DEFAULT_LOCAL_TTS_MODEL,
      "--text",
      input.text,
      "--voice",
      input.voice ?? DEFAULT_LOCAL_TTS_VOICE,
      "--speed",
      formatNumber(input.speed ?? DEFAULT_LOCAL_TTS_SPEED),
      "--lang_code",
      input.langCode ?? DEFAULT_LOCAL_TTS_LANG_CODE,
      "--output_path",
      input.outputDirectory,
      "--file_prefix",
      input.filePrefix ?? DEFAULT_LOCAL_TTS_FILE_PREFIX,
      "--join_audio",
      "--audio_format",
      input.audioFormat ?? DEFAULT_LOCAL_TTS_AUDIO_FORMAT
    ]
  };
}

export function buildRetimedVoiceoverArgs(input: {
  inputPath: string;
  outputPath: string;
  inputDurationSeconds: number;
  targetDurationSeconds: number;
}): string[] {
  if (!Number.isFinite(input.inputDurationSeconds) || input.inputDurationSeconds <= 0) {
    throw new Error("inputDurationSeconds must be a positive finite number");
  }
  if (!Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) {
    throw new Error("targetDurationSeconds must be a positive finite number");
  }

  return [
    "-y",
    "-i",
    input.inputPath,
    "-af",
    [
      ...atempoFilters(input.inputDurationSeconds / input.targetDurationSeconds),
      "apad",
      `atrim=duration=${formatSeconds(input.targetDurationSeconds)}`
    ].join(","),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    input.outputPath
  ];
}

export function isSafeTempoAdjustment(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= 1 - MAX_SAFE_TEMPO_DELTA && ratio <= 1 + MAX_SAFE_TEMPO_DELTA;
}

export function resolveVoiceoverAudioPath(input: {
  rootDir: string;
  projectDir: string;
  voiceover?: VoiceoverConfig;
}): string {
  if (input.voiceover?.mode === "provided_audio") {
    return input.voiceover.audioPath;
  }

  if (input.voiceover?.mode === "local_tts") {
    return localTtsVoiceoverAudioPath(input.projectDir);
  }

  return voiceoverAudioPath(input.projectDir);
}

export function voiceoverTextPath(projectDir: string): string {
  return join(projectDir, "media", "voiceover", "voiceover.txt");
}

export function voiceoverAudioPath(projectDir: string): string {
  return join(projectDir, "media", "voiceover", "voiceover.aiff");
}

export function rawVoiceoverAudioPath(projectDir: string): string {
  return join(projectDir, "media", "voiceover", "voiceover.raw.aiff");
}

export function localTtsVoiceoverAudioPath(projectDir: string): string {
  return join(projectDir, "media", "voiceover", "voiceover.wav");
}

export function voiceoverDirectory(projectDir: string): string {
  return join(projectDir, "media", "voiceover");
}

function atempoFilters(tempo: number): string[] {
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new Error("tempo must be a positive finite number");
  }

  const filters: string[] = [];
  let remaining = tempo;

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }

  filters.push(`atempo=${formatTempo(remaining)}`);
  return filters;
}

function formatTempo(value: number): string {
  return value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "");
}

function formatNumber(value: number): string {
  return value.toString();
}
