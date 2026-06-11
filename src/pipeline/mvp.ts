import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { createProject, readBrief, slugify, writeJson } from "../domain/project.js";
import { ShotManifestSchema } from "../domain/schemas.js";
import type { Brief, ShotManifest } from "../domain/schemas.js";
import { shotsToSrt } from "../domain/srt.js";
import {
  ffmpegSupportsFilter as defaultFfmpegSupportsFilter,
  buildNormalizeArgs,
  buildRenderArgs,
  runFfmpeg as defaultRunFfmpeg,
  writeConcatList
} from "../ffmpeg/assembly.js";
import { probeVideo as defaultProbeVideo } from "../ffmpeg/probe.js";
import {
  downloadFile as defaultDownloadFile,
  runHiggsfieldGenerate as defaultRunHiggsfieldGenerate,
  writeMetadata as defaultWriteMetadata
} from "../higgsfield/runner.js";
import { validateProbe, writeQaReport } from "../qa/report.js";

type ExportTarget = {
  suffix: string;
  width: number;
  height: number;
};

type MvpProject = {
  slug: string;
  projectDir: string;
  manifestPath: string;
};

export type MvpPipelineDependencies = {
  runHiggsfieldGenerate: typeof defaultRunHiggsfieldGenerate;
  downloadFile: typeof defaultDownloadFile;
  writeMetadata: typeof defaultWriteMetadata;
  runFfmpeg: typeof defaultRunFfmpeg;
  ffmpegSupportsFilter: typeof defaultFfmpegSupportsFilter;
  probeVideo: typeof defaultProbeVideo;
};

const EXPORT_TARGETS: readonly ExportTarget[] = [
  { suffix: "youtube-16x9", width: 1920, height: 1080 },
  { suffix: "shorts-9x16", width: 1080, height: 1920 }
];

const DEFAULT_DEPENDENCIES: MvpPipelineDependencies = {
  runHiggsfieldGenerate: defaultRunHiggsfieldGenerate,
  downloadFile: defaultDownloadFile,
  writeMetadata: defaultWriteMetadata,
  runFfmpeg: defaultRunFfmpeg,
  ffmpegSupportsFilter: defaultFfmpegSupportsFilter,
  probeVideo: defaultProbeVideo
};

async function readShotManifest(path: string): Promise<ShotManifest> {
  const raw = await readFile(path, "utf8");
  return ShotManifestSchema.parse(JSON.parse(raw));
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function resolveBriefPath(rootDir: string, briefPath: string): string {
  return isAbsolute(briefPath) ? briefPath : join(rootDir, briefPath);
}

function projectPaths(rootDir: string, topic: string): MvpProject {
  const slug = slugify(topic);
  const projectDir = join(rootDir, "projects", slug);

  return {
    slug,
    projectDir,
    manifestPath: join(projectDir, "shot-manifest.json")
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function openOrCreateProject(rootDir: string, brief: Brief): Promise<MvpProject> {
  const existingProject = projectPaths(rootDir, brief.topic);

  if (await fileExists(existingProject.manifestPath)) {
    return existingProject;
  }

  return createProject(rootDir, brief);
}

function generatedClipManifestPath(slug: string, shotId: string): string {
  return join("projects", slug, "media", "generated", `${shotId}.mp4`);
}

function resolveLocalPath(rootDir: string, localPath: string): string {
  return isAbsolute(localPath) ? localPath : join(rootDir, localPath);
}

async function validLocalClipPath(
  rootDir: string,
  localPath: string | undefined,
  expectedLocalPath: string
): Promise<string | undefined> {
  if (localPath !== expectedLocalPath) {
    return undefined;
  }

  try {
    const resolvedPath = resolveLocalPath(rootDir, localPath);
    const info = await stat(resolvedPath);
    return info.isFile() && info.size > 0 ? resolvedPath : undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

function extractJobId(metadata: unknown): string | undefined {
  return (
    getStringProperty(metadata, "jobId") ??
    getStringProperty(metadata, "job_id") ??
    getStringProperty(metadata, "id") ??
    getStringProperty((metadata as { job?: unknown } | undefined)?.job, "id") ??
    getStringProperty((metadata as { data?: unknown } | undefined)?.data, "id")
  );
}

export async function runMvp(
  rootDir: string,
  briefPath: string,
  dependencies: MvpPipelineDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  const brief = await readBrief(resolveBriefPath(rootDir, briefPath));
  const project = await openOrCreateProject(rootDir, brief);
  const manifest = await readShotManifest(project.manifestPath);
  const generatedDir = join(project.projectDir, "media", "generated");
  const resolvedClipPaths = new Map<string, string>();

  for (const shot of manifest.shots) {
    const manifestLocalPath = generatedClipManifestPath(project.slug, shot.id);
    const existingClipPath = await validLocalClipPath(rootDir, shot.localPath, manifestLocalPath);
    if (existingClipPath) {
      resolvedClipPaths.set(shot.id, existingClipPath);
      continue;
    }

    const videoPath = resolveLocalPath(rootDir, manifestLocalPath);
    const metadataPath = join(generatedDir, `${shot.id}.json`);
    let outputUrl = shot.outputUrl;

    if (!outputUrl) {
      const generated = await dependencies.runHiggsfieldGenerate(shot);
      const jobId = extractJobId(generated.metadata);

      outputUrl = generated.outputUrl;
      shot.outputUrl = outputUrl;
      shot.status = "generated";
      if (jobId) {
        shot.higgsfieldJobId = jobId;
      }

      await dependencies.writeMetadata(metadataPath, generated.metadata);
      await writeJson(project.manifestPath, manifest);
    }

    await dependencies.downloadFile(outputUrl, videoPath);

    shot.outputUrl = outputUrl;
    shot.localPath = manifestLocalPath;
    shot.status = "generated";
    resolvedClipPaths.set(shot.id, videoPath);

    await writeJson(project.manifestPath, manifest);
  }

  const srtPath = join(project.projectDir, "exports", `${project.slug}.srt`);
  await writeTextFile(srtPath, shotsToSrt(manifest.shots));

  const normalizedPaths: string[] = [];
  for (const shot of manifest.shots) {
    const manifestLocalPath = generatedClipManifestPath(project.slug, shot.id);
    const inputPath =
      resolvedClipPaths.get(shot.id) ?? await validLocalClipPath(rootDir, shot.localPath, manifestLocalPath);
    if (!inputPath) {
      throw new Error(`shot ${shot.id} does not have a localPath`);
    }

    const normalizedPath = join(project.projectDir, "work", "normalized", `${shot.id}.mp4`);
    await dependencies.runFfmpeg(
      buildNormalizeArgs({
        inputPath,
        outputPath: normalizedPath,
        durationSeconds: shot.durationSeconds
      })
    );
    normalizedPaths.push(normalizedPath);
  }

  const concatListPath = join(project.projectDir, "work", "concat.txt");
  await writeConcatList(concatListPath, normalizedPaths);
  const burnSubtitles = await dependencies.ffmpegSupportsFilter("subtitles");

  for (const target of EXPORT_TARGETS) {
    const exportPath = join(project.projectDir, "exports", `${project.slug}-${target.suffix}.mp4`);
    await dependencies.runFfmpeg(
      buildRenderArgs({
        concatListPath,
        srtPath,
        outputPath: exportPath,
        width: target.width,
        height: target.height,
        burnSubtitles
      })
    );

    const probe = await dependencies.probeVideo(exportPath);
    const report = validateProbe(exportPath, {
      expectedWidth: target.width,
      expectedHeight: target.height,
      expectedDurationSeconds: manifest.totalDurationSeconds,
      probe
    });
    await writeQaReport(join(project.projectDir, "reports", `${target.suffix}-qa.json`), report);
  }
}
