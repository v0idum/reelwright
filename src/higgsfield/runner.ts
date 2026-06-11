import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Shot } from "../domain/schemas.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DIAGNOSTIC_EXCERPT_LENGTH = 2_000;
const MEDIA_FIELD_NAMES = new Set([
  "url",
  "video_url",
  "videoUrl",
  "download_url",
  "downloadUrl",
  "asset_url",
  "assetUrl",
  "output_url",
  "outputUrl",
  "file_url",
  "fileUrl"
]);
const NON_GENERIC_MEDIA_FIELD_NAMES = new Set(
  [...MEDIA_FIELD_NAMES].filter((name) => name !== "url")
);
const MEDIA_CONTAINER_NAMES = new Set([
  "result",
  "results",
  "response",
  "data",
  "output",
  "outputs",
  "asset",
  "assets",
  "media",
  "video",
  "videos",
  "file",
  "files",
  "download",
  "downloads",
  "render",
  "renders",
  "generation",
  "generations"
]);

export type GenerateInput = {
  model: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution?: string;
  startImage?: string;
  endImage?: string;
};

type ProcessOutput = {
  stdout: string;
  stderr: string;
};

type RunProcessOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type MediaCandidate = {
  url: string;
  score: number;
  order: number;
};

export function buildGenerateArgs(input: GenerateInput): string[] {
  const args = [
    "generate",
    "create",
    input.model,
    "--prompt",
    input.prompt,
    "--duration",
    formatGenerateDuration(input.durationSeconds),
    "--aspect_ratio",
    input.aspectRatio
  ];

  args.push(...buildQualityArgs(input));

  if (input.startImage) {
    args.push("--start-image", input.startImage);
  }

  if (input.endImage) {
    args.push("--end-image", input.endImage);
  }

  args.push("--wait", "--json");

  return args;
}

function formatGenerateDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Higgsfield durationSeconds must be a positive finite number");
  }

  if (durationSeconds > 30 + Number.EPSILON) {
    throw new Error("Higgsfield durationSeconds must be <= 30");
  }

  return String(Math.min(30, Math.max(1, Math.ceil(durationSeconds))));
}

function buildQualityArgs(input: GenerateInput): string[] {
  if (input.model === "kling3_0") {
    return ["--mode", input.resolution === "4k" ? "4k" : "std"];
  }

  return ["--resolution", input.resolution ?? "720p"];
}

export function findFirstMediaUrl(value: unknown): string | undefined {
  const candidates: MediaCandidate[] = [];
  findMediaUrlCandidates(value, new WeakSet<object>(), [], candidates);
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0]?.url;
}

export function parseHiggsfieldJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("Higgsfield stdout was empty");
  }

  const direct = tryParseJson(trimmed);
  if (direct.parsed) {
    return direct.value;
  }

  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) {
      continue;
    }

    const parsedLine = tryParseJson(line);
    if (parsedLine.parsed) {
      return parsedLine.value;
    }
  }

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") {
      continue;
    }

    const parsedSuffix = tryParseJson(trimmed.slice(index));
    if (parsedSuffix.parsed) {
      return parsedSuffix.value;
    }
  }

  throw new Error("Higgsfield stdout did not contain a parseable final JSON payload");
}

export async function runHiggsfieldGenerate(
  shot: Shot
): Promise<{ metadata: unknown; outputUrl: string }> {
  const args = buildGenerateArgs({
    model: shot.model,
    prompt: shot.prompt,
    durationSeconds: shot.durationSeconds,
    aspectRatio: shot.aspectRatio,
    resolution: shot.generation?.resolution,
    startImage: shot.generation?.startImage,
    endImage: shot.generation?.endImage
  });
  const { stdout, stderr } = await runProcess("higgsfield", args);
  let metadata: unknown;

  try {
    metadata = parseHiggsfieldJsonPayload(stdout);
  } catch (error) {
    throw new Error(
      [
        `Failed to parse Higgsfield JSON for shot ${shot.id}.`,
        `Command args: ${formatArgsForDiagnostics(args)}.`,
        `stdout: ${excerpt(stdout)}.`,
        `stderr: ${excerpt(stderr)}.`
      ].join(" "),
      { cause: error }
    );
  }

  const outputUrl = findFirstMediaUrl(metadata);

  if (!outputUrl) {
    throw new Error(
      [
        `Higgsfield response did not include a media URL for shot ${shot.id}.`,
        `Command args: ${formatArgsForDiagnostics(args)}.`,
        `metadata: ${excerpt(JSON.stringify(metadata, null, 2))}.`,
        `stdout: ${excerpt(stdout)}.`,
        `stderr: ${excerpt(stderr)}.`
      ].join(" ")
    );
  }

  return { metadata, outputUrl };
}

export async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error(`Failed to download ${url}: response body was empty`);
  }

  await mkdir(dirname(destination), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    createWriteStream(destination)
  );
}

export async function writeMetadata(path: string, metadata: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = new CappedOutput(maxOutputBytes);
    const stderr = new CappedOutput(maxOutputBytes);
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      finish(
        reject,
        new Error(
          [
            `${command} timed out after ${timeoutMs}ms.`,
            `Command args: ${formatArgsForDiagnostics(args)}.`,
            `stdout: ${excerpt(stdout.toString())}.`,
            `stderr: ${excerpt(stderr.toString())}.`
          ].join(" ")
        ),
        false
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code === 0) {
        finish(resolve, { stdout: stdout.toString(), stderr: stderr.toString() });
        return;
      }

      finish(
        reject,
        new Error(
          [
            `${command} exited with code ${code}.`,
            `Command args: ${formatArgsForDiagnostics(args)}.`,
            `stdout: ${excerpt(stdout.toString())}.`,
            `stderr: ${excerpt(stderr.toString())}.`
          ].join(" ")
        )
      );
    });

    function finish<T>(
      settle: (value: T) => void,
      value: T,
      clearKillTimer = true
    ): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutTimer);
      if (clearKillTimer && killTimer) {
        clearTimeout(killTimer);
      }
      settle(value);
    }
  });
}

function findMediaUrlCandidates(
  value: unknown,
  seen: WeakSet<object>,
  path: string[],
  candidates: MediaCandidate[]
): void {
  if (typeof value === "string") {
    const score = scoreMediaUrl(value, path);
    if (score > 0) {
      candidates.push({ url: value, score, order: candidates.length });
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findMediaUrlCandidates(item, seen, [...path, String(index)], candidates);
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    findMediaUrlCandidates(item, seen, [...path, key], candidates);
  }
}

function scoreMediaUrl(value: string, path: string[]): number {
  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return 0;
  }

  const fieldName = path.at(-1);
  const fieldIsLikelyMedia = fieldName ? MEDIA_FIELD_NAMES.has(fieldName) : false;
  const fieldIsNonGenericMedia = fieldName ? NON_GENERIC_MEDIA_FIELD_NAMES.has(fieldName) : false;
  const fieldHasLikelyContainer = path
    .slice(0, -1)
    .some((part) => MEDIA_CONTAINER_NAMES.has(part));
  const urlHasMediaHint = hasMediaUrlHint(parsed);

  if (fieldIsNonGenericMedia) {
    return urlHasMediaHint ? 120 : 110;
  }

  if (fieldIsLikelyMedia && fieldHasLikelyContainer) {
    return urlHasMediaHint ? 105 : 100;
  }

  if (urlHasMediaHint) {
    return fieldIsLikelyMedia ? 90 : 80;
  }

  if (fieldIsLikelyMedia) {
    return 70;
  }

  return 0;
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function hasMediaUrlHint(url: URL): boolean {
  if (/\.(mp4|mov|webm)$/i.test(url.pathname)) {
    return true;
  }

  for (const [key, value] of url.searchParams) {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = value.toLowerCase();
    if (
      /^(format|output_format|file_format|ext|extension|type|mime|mime_type|content_type|response-content-type)$/i.test(
        normalizedKey
      ) &&
      /(mp4|mov|webm|video\/)/i.test(normalizedValue)
    ) {
      return true;
    }
  }

  return /(format|type|mime|content-type|response-content-type)=.*(mp4|mov|webm|video%2f)/i.test(
    url.search
  );
}

function tryParseJson(value: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(value) as unknown };
  } catch {
    return { parsed: false };
  }
}

function excerpt(value: string): string {
  if (!value) {
    return "<empty>";
  }

  if (value.length <= DIAGNOSTIC_EXCERPT_LENGTH) {
    return value;
  }

  return `...${value.slice(-DIAGNOSTIC_EXCERPT_LENGTH)}`;
}

function formatArgsForDiagnostics(args: string[]): string {
  return excerpt(JSON.stringify(args));
}

class CappedOutput {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxBytes) {
      this.buffer = this.buffer.subarray(this.buffer.length - this.maxBytes);
    }
  }

  toString(): string {
    return this.buffer.toString("utf8");
  }
}
