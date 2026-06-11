import { spawn } from "node:child_process";

export type ProbeSummary = {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
  bitrate: number;
};

type ProbeStream = {
  codec_type?: string;
  width?: number | string;
  height?: number | string;
  duration?: number | string;
  bit_rate?: number | string;
};

type ProbeFormat = {
  duration?: number | string;
  bit_rate?: number | string;
};

type ProbeJson = {
  streams?: ProbeStream[];
  format?: ProbeFormat;
};

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parsePositiveInteger(value: unknown, field: string): number {
  const parsed = parseFiniteNumber(value);
  if (parsed === undefined || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`ffprobe video stream has invalid ${field}`);
  }

  return parsed;
}

function parsePositiveNumber(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export function parseProbe(raw: any): ProbeSummary {
  const probe = raw as ProbeJson;
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  if (!video) {
    throw new Error("ffprobe output did not contain a video stream");
  }

  const durationSeconds = parsePositiveNumber(probe.format?.duration) ?? parsePositiveNumber(video.duration);
  const bitrate = parsePositiveNumber(probe.format?.bit_rate) ?? parsePositiveNumber(video.bit_rate) ?? 0;

  return {
    width: parsePositiveInteger(video.width, "width"),
    height: parsePositiveInteger(video.height, "height"),
    durationSeconds: durationSeconds ?? Number.NaN,
    hasAudio: Boolean(audio),
    bitrate
  };
}

export function parseMediaDuration(raw: any): number {
  const probe = raw as ProbeJson;
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const durationSeconds =
    parsePositiveNumber(probe.format?.duration) ??
    streams
      .map((stream) => parsePositiveNumber(stream.duration))
      .find((duration) => duration !== undefined);

  if (durationSeconds === undefined) {
    throw new Error("ffprobe output did not contain a positive media duration");
  }

  return durationSeconds;
}

export async function probeVideo(path: string): Promise<ProbeSummary> {
  const output = await runProcess("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path
  ]);

  return parseProbe(JSON.parse(output));
}

export async function probeMediaDuration(path: string): Promise<number> {
  const output = await runProcess("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path
  ]);

  return parseMediaDuration(JSON.parse(output));
}
