import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type RenderTarget = {
  concatListPath: string;
  srtPath: string;
  outputPath: string;
  width: number;
  height: number;
  burnSubtitles?: boolean;
};

export type VoiceoverRenderTarget = RenderTarget & {
  voiceoverPath: string;
};

export type NormalizeTarget = {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
};

function quoteConcatPath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function escapeFilterValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll(",", "\\,")
    .replaceAll(" ", "\\ ");
}

export function concatFile(paths: string[]): string {
  return paths.map((path) => `file ${quoteConcatPath(path)}\n`).join("");
}

export function buildNormalizeArgs(target: NormalizeTarget): string[] {
  return [
    "-y",
    "-i",
    target.inputPath,
    "-t",
    String(target.durationSeconds),
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    target.outputPath
  ];
}

export function buildRenderArgs(target: RenderTarget): string[] {
  const videoFilter = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}`
  ];

  if (target.burnSubtitles !== false) {
    videoFilter.push(`subtitles=filename=${escapeFilterValue(target.srtPath)}`);
  }

  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    target.concatListPath,
    "-vf",
    videoFilter.join(","),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    target.outputPath
  ];
}

export function buildRenderWithVoiceoverArgs(target: VoiceoverRenderTarget): string[] {
  const videoFilter = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}`
  ];

  if (target.burnSubtitles !== false) {
    videoFilter.push(`subtitles=filename=${escapeFilterValue(target.srtPath)}`);
  }

  const filterGraph = [
    `[0:v]${videoFilter.join(",")}[vout]`,
    "[0:a]volume=0.18[bed]",
    "[1:a]volume=1.0[vo]",
    "[bed][vo]amix=inputs=2:duration=longest:dropout_transition=0[aout]"
  ].join(";");

  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    target.concatListPath,
    "-i",
    target.voiceoverPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    target.outputPath
  ];
}

export async function ffmpegSupportsFilter(filterName: string): Promise<boolean> {
  const output = await runFfmpegCapture(["-filters"]);
  return output
    .split("\n")
    .some((line) => line.trim().split(/\s+/)[1] === filterName);
}

export async function writeConcatList(path: string, clipPaths: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, concatFile(clipPaths), "utf8");
}

export async function runFfmpeg(args: string[]): Promise<void> {
  const outputPath = args.at(-1);
  if (!outputPath) {
    throw new Error("ffmpeg args must include an output path as the final argument");
  }

  await mkdir(dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function runFfmpegCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";

    ffmpeg.stdout.setEncoding("utf8");
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    ffmpeg.stderr.on("data", (chunk: string) => {
      output += chunk;
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(new Error(output.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}
