import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { ZodError } from "zod";
import { readBrief, slugify, writeJson } from "../domain/project.js";
import { ShotManifestSchema } from "../domain/schemas.js";
import type { Brief, ParsedBrief, ShotManifest } from "../domain/schemas.js";
import { shotsToSrt } from "../domain/srt.js";
import {
  buildLocalTtsVoiceoverArgs,
  buildRetimedVoiceoverArgs,
  buildLocalPlaceholderVoiceoverArgs,
  rawVoiceoverAudioPath,
  resolveVoiceoverAudioPath,
  voiceoverText,
  voiceoverDirectory,
  voiceoverTextPath
} from "../audio/voiceover.js";
import {
  ffmpegSupportsFilter as defaultFfmpegSupportsFilter,
  buildNormalizeArgs,
  buildRenderWithVoiceoverArgs,
  runFfmpeg as defaultRunFfmpeg,
  writeConcatList
} from "../ffmpeg/assembly.js";
import {
  probeMediaDuration as defaultProbeMediaDuration,
  probeVideo as defaultProbeVideo
} from "../ffmpeg/probe.js";
import {
  downloadFile as defaultDownloadFile,
  runHiggsfieldGenerate as defaultRunHiggsfieldGenerate,
  writeMetadata as defaultWriteMetadata
} from "../higgsfield/runner.js";
import {
  createVideoPlan as createTemplateVideoPlan,
  parseVideoPlan,
  videoPlanToScriptMarkdown
} from "../planning/director.js";
import type { VideoPlan } from "../planning/director.js";
import { maxGenerationDurationSeconds } from "../planning/generation-limits.js";
import { createPlanWithLocalLlm } from "../planning/local-llm.js";
import { compileShotManifest } from "../planning/manifest.js";
import { validateCreativeQa, writeCreativeQaReport } from "../qa/creative.js";
import { validateProbe, writeQaReport } from "../qa/report.js";

type ExportTarget = {
  suffix: string;
  width: number;
  height: number;
};

type DirectorMvpProject = {
  slug: string;
  projectDir: string;
  planPath: string;
  scriptPath: string;
  manifestPath: string;
};

type VideoPlanReadResult = {
  plan: VideoPlan;
  refreshed: boolean;
};

type VoiceoverResult = {
  path: string;
  provider: "provided_audio" | "local_tts" | "local_placeholder";
  durationSeconds?: number;
  targetDurationSeconds?: number;
  tempoAdjustmentRatio?: number;
  timelineAdjusted?: boolean;
};

export type DirectorMvpPipelineDependencies = {
  runHiggsfieldGenerate: typeof defaultRunHiggsfieldGenerate;
  downloadFile: typeof defaultDownloadFile;
  writeMetadata: typeof defaultWriteMetadata;
  runFfmpeg: typeof defaultRunFfmpeg;
  ffmpegSupportsFilter: typeof defaultFfmpegSupportsFilter;
  probeVideo: typeof defaultProbeVideo;
  probeMediaDuration: typeof defaultProbeMediaDuration;
  runVoiceoverCommand: (command: string, args: string[]) => Promise<void>;
  createVideoPlan?: (brief: ParsedBrief) => VideoPlan | Promise<VideoPlan>;
};

const EXPORT_TARGETS: readonly ExportTarget[] = [
  { suffix: "youtube-16x9", width: 1920, height: 1080 },
  { suffix: "shorts-9x16", width: 1080, height: 1920 }
];

const DEFAULT_DEPENDENCIES: DirectorMvpPipelineDependencies = {
  runHiggsfieldGenerate: defaultRunHiggsfieldGenerate,
  downloadFile: defaultDownloadFile,
  writeMetadata: defaultWriteMetadata,
  runFfmpeg: defaultRunFfmpeg,
  ffmpegSupportsFilter: defaultFfmpegSupportsFilter,
  probeVideo: defaultProbeVideo,
  probeMediaDuration: defaultProbeMediaDuration,
  runVoiceoverCommand: runCommand,
  createVideoPlan: createDefaultVideoPlan
};

const VOICEOVER_DURATION_TOLERANCE_SECONDS = 0.75;
const MIN_LOCAL_TTS_MVP_SECONDS = 60;

async function createDefaultVideoPlan(brief: ParsedBrief): Promise<VideoPlan> {
  if (brief.planning.mode === "local_llm") {
    return createPlanWithLocalLlm(brief);
  }

  return createTemplateVideoPlan(brief);
}

async function createPlannedVideoPlan(
  brief: ParsedBrief,
  dependencies: DirectorMvpPipelineDependencies
): Promise<VideoPlan> {
  return (dependencies.createVideoPlan ?? createDefaultVideoPlan)(brief);
}

async function readShotManifest(path: string): Promise<ShotManifest> {
  const raw = await readFile(path, "utf8");
  return ShotManifestSchema.parse(JSON.parse(raw));
}

async function readVideoPlan(path: string): Promise<VideoPlan> {
  const raw = await readFile(path, "utf8");
  return parseVideoPlan(JSON.parse(raw));
}

async function writeTextFile(path: string, content: string): Promise<boolean> {
  try {
    if (await readFile(path, "utf8") === content) {
      return false;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

function resolveBriefPath(rootDir: string, briefPath: string): string {
  return isAbsolute(briefPath) ? briefPath : join(rootDir, briefPath);
}

function projectPaths(rootDir: string, topic: string): DirectorMvpProject {
  const slug = slugify(topic);
  const projectDir = join(rootDir, "projects", slug);

  return {
    slug,
    projectDir,
    planPath: join(projectDir, "video-plan.json"),
    scriptPath: join(projectDir, "script.md"),
    manifestPath: join(projectDir, "shot-manifest.json")
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function validFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isVideoPlanParseOrValidationError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof ZodError;
}

async function ensureProjectDirs(projectDir: string): Promise<void> {
  await Promise.all([
    mkdir(join(projectDir, "media", "generated"), { recursive: true }),
    mkdir(join(projectDir, "media", "voiceover"), { recursive: true }),
    mkdir(join(projectDir, "exports"), { recursive: true }),
    mkdir(join(projectDir, "reports"), { recursive: true }),
    mkdir(join(projectDir, "work", "normalized"), { recursive: true })
  ]);
}

async function openProject(rootDir: string, brief: Brief): Promise<DirectorMvpProject> {
  const project = projectPaths(rootDir, brief.topic);
  await ensureProjectDirs(project.projectDir);
  return project;
}

async function readOrCreateVideoPlan(
  project: DirectorMvpProject,
  brief: ParsedBrief,
  dependencies: DirectorMvpPipelineDependencies
): Promise<VideoPlanReadResult> {
  if (await fileExists(project.planPath)) {
    let existingPlan: VideoPlan;
    try {
      existingPlan = await readVideoPlan(project.planPath);
    } catch (error) {
      if (!isVideoPlanParseOrValidationError(error)) {
        throw error;
      }

      const nextPlan = await createPlannedVideoPlan(brief, dependencies);
      await writeJson(project.planPath, nextPlan);
      return { plan: nextPlan, refreshed: true };
    }

    const nextPlan = await createPlannedVideoPlan(brief, dependencies);
    if (isCachedPlanCurrent(existingPlan, nextPlan) && brief.planning.mode !== "local_llm") {
      return { plan: existingPlan, refreshed: false };
    }

    await writeJson(project.planPath, nextPlan);
    return { plan: nextPlan, refreshed: true };
  }

  const plan = await createPlannedVideoPlan(brief, dependencies);
  await writeJson(project.planPath, plan);
  return { plan, refreshed: false };
}

function isCachedPlanCurrent(existingPlan: VideoPlan, nextPlan: VideoPlan): boolean {
  return JSON.stringify(existingPlan) === JSON.stringify(nextPlan);
}

function shouldRefreshVideoPlan(plan: VideoPlan, brief: ParsedBrief): boolean {
  return brief.voiceover?.mode === "local_tts"
    && (brief.targetDurationSeconds ?? 0) >= MIN_LOCAL_TTS_MVP_SECONDS
    && plan.targetDurationSeconds < MIN_LOCAL_TTS_MVP_SECONDS;
}

async function readOrCreateShotManifest(
  project: DirectorMvpProject,
  plan: VideoPlan
): Promise<ShotManifest> {
  if (await fileExists(project.manifestPath)) {
    return readShotManifest(project.manifestPath);
  }

  const manifest = compileShotManifest(plan);
  await writeJson(project.manifestPath, manifest);
  return manifest;
}

function mergeExistingGeneratedShotState(fresh: ShotManifest, existing: ShotManifest): ShotManifest {
  const existingById = new Map(existing.shots.map((shot) => [shot.id, shot]));

  for (const shot of fresh.shots) {
    const existingShot = existingById.get(shot.id);
    if (!existingShot) {
      continue;
    }

    shot.status = existingShot.status;
    shot.outputUrl = existingShot.outputUrl;
    shot.localPath = existingShot.localPath;
    shot.higgsfieldJobId = existingShot.higgsfieldJobId;
    shot.rejectedTakes = existingShot.rejectedTakes;
  }

  return fresh;
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

  const resolvedPath = resolveLocalPath(rootDir, localPath);
  return await validFile(resolvedPath) ? resolvedPath : undefined;
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

async function ensureVoiceover(
  rootDir: string,
  project: DirectorMvpProject,
  brief: ParsedBrief,
  plan: VideoPlan,
  dependencies: DirectorMvpPipelineDependencies
): Promise<VoiceoverResult> {
  const textPath = voiceoverTextPath(project.projectDir);
  const text = voiceoverText(plan);
  const textChanged = await writeTextFile(textPath, text);

  const audioPath = resolveVoiceoverAudioPath({
    rootDir,
    projectDir: project.projectDir,
    voiceover: brief.voiceover
  });

  if (brief.voiceover?.mode === "provided_audio") {
    return {
      path: audioPath,
      provider: "provided_audio"
    };
  }

  if (brief.voiceover?.mode === "local_tts") {
    if (textChanged || !await validFile(audioPath)) {
      const command = buildLocalTtsVoiceoverArgs({
        text,
        outputDirectory: voiceoverDirectory(project.projectDir),
        filePrefix: "voiceover",
        model: brief.voiceover.model,
        voice: brief.voiceover.voice,
        speed: brief.voiceover.speed,
        langCode: brief.voiceover.langCode,
        audioFormat: brief.voiceover.audioFormat
      });
      await dependencies.runVoiceoverCommand(command.command, command.args);
    }

    if (!await validFile(audioPath)) {
      throw new Error(`local TTS did not create expected voiceover file: ${audioPath}`);
    }

    return {
      path: audioPath,
      provider: "local_tts",
      durationSeconds: await dependencies.probeMediaDuration(audioPath),
      targetDurationSeconds: plan.voiceoverSegments.at(-1)?.endSeconds ?? plan.targetDurationSeconds
    };
  }

  const targetDurationSeconds = plan.voiceoverSegments.at(-1)?.endSeconds ?? plan.targetDurationSeconds;
  const existingAudioValid = await validFile(audioPath);
  let audioNeedsRetiming = textChanged || !existingAudioValid;
  if (existingAudioValid) {
    const existingDurationSeconds = await dependencies.probeMediaDuration(audioPath);
    audioNeedsRetiming =
      Math.abs(existingDurationSeconds - targetDurationSeconds) > VOICEOVER_DURATION_TOLERANCE_SECONDS;
  }

  if (audioNeedsRetiming) {
    const rawPath = rawVoiceoverAudioPath(project.projectDir);
    const command = buildLocalPlaceholderVoiceoverArgs({
      textPath,
      outputPath: rawPath,
      voice: brief.voiceover?.mode === "local_placeholder" ? brief.voiceover.voice : undefined
    });
    await dependencies.runVoiceoverCommand(command.command, command.args);

    const rawDurationSeconds = await dependencies.probeMediaDuration(rawPath);
    const tempoAdjustmentRatio = rawDurationSeconds / targetDurationSeconds;
    await dependencies.runFfmpeg(
      buildRetimedVoiceoverArgs({
        inputPath: rawPath,
        outputPath: audioPath,
        inputDurationSeconds: rawDurationSeconds,
        targetDurationSeconds
      })
    );

    return {
      path: audioPath,
      provider: "local_placeholder",
      durationSeconds: targetDurationSeconds,
      targetDurationSeconds,
      tempoAdjustmentRatio
    };
  }

  return {
    path: audioPath,
    provider: "local_placeholder",
    durationSeconds: await dependencies.probeMediaDuration(audioPath),
    targetDurationSeconds
  };
}

function alignPlanAndManifestToVoiceoverDuration(
  plan: VideoPlan,
  manifest: ShotManifest,
  voiceover: VoiceoverResult
): void {
  if (voiceover.provider !== "local_tts" || voiceover.durationSeconds === undefined) {
    return;
  }

  const currentDurationSeconds = manifest.totalDurationSeconds;
  if (
    !Number.isFinite(currentDurationSeconds)
    || currentDurationSeconds <= 0
    || Math.abs(voiceover.durationSeconds - currentDurationSeconds) <= VOICEOVER_DURATION_TOLERANCE_SECONDS
  ) {
    return;
  }

  scalePlanTimeline(plan, voiceover.durationSeconds);
  replaceManifest(manifest, mergeExistingGeneratedShotState(compileShotManifest(plan), manifest));
  voiceover.timelineAdjusted = true;
}

function scalePlanTimeline(plan: VideoPlan, targetDurationSeconds: number): void {
  const currentDurationSeconds = plan.voiceoverSegments.at(-1)?.endSeconds ?? plan.targetDurationSeconds;
  const scale = targetDurationSeconds / currentDurationSeconds;

  plan.targetDurationSeconds = roundSeconds(targetDurationSeconds);
  scaleIntervals(plan.chapters, scale, targetDurationSeconds);
  scaleIntervals(plan.scenes, scale, targetDurationSeconds);
  scaleIntervals(plan.voiceoverSegments, scale, targetDurationSeconds);
  scaleIntervals(plan.plannedShots, scale, targetDurationSeconds);
  splitLongPlanShots(plan, maxGenerationDurationSeconds(plan.generationDefaults.model));
}

function replaceManifest(target: ShotManifest, source: ShotManifest): void {
  target.project = source.project;
  target.totalDurationSeconds = source.totalDurationSeconds;
  target.shots = source.shots;
}

function scaleIntervals<T extends { startSeconds: number; endSeconds: number }>(
  items: T[],
  scale: number,
  targetDurationSeconds: number
): void {
  items.forEach((item, index) => {
    item.startSeconds = roundSeconds(item.startSeconds * scale);
    item.endSeconds = index === items.length - 1
      ? roundSeconds(targetDurationSeconds)
      : roundSeconds(item.endSeconds * scale);
  });
}

function splitLongPlanShots(plan: VideoPlan, maxDurationSeconds: number): boolean {
  const needsSplit = plan.plannedShots.some((shot) => {
    return shot.endSeconds - shot.startSeconds > maxDurationSeconds;
  });
  if (!needsSplit) {
    return false;
  }

  const nextBeats: VideoPlan["beats"] = [];
  const nextVoiceoverSegments: VideoPlan["voiceoverSegments"] = [];
  const nextPlannedShots: VideoPlan["plannedShots"] = [];

  for (const shot of plan.plannedShots) {
    const beat = plan.beats.find((candidate) => candidate.id === shot.beatId);
    const voiceover = plan.voiceoverSegments.find((segment) => {
      return segment.id === beat?.voiceoverSegmentId;
    });
    if (!beat || !voiceover) {
      throw new Error(`Cannot split ${shot.id}; missing beat or voiceover segment`);
    }

    const intervals = splitInterval(shot.startSeconds, shot.endSeconds, maxDurationSeconds);
    const textParts = splitText(voiceover.text, intervals.length);

    intervals.forEach((interval, partIndex) => {
      const index = nextPlannedShots.length + 1;
      const shotId = formatPipelineId("shot", index);
      const beatId = formatPipelineId("beat", index);
      const voiceoverId = formatPipelineId("vo", index);
      const hasMultipleParts = intervals.length > 1;

      nextVoiceoverSegments.push({
        ...voiceover,
        id: voiceoverId,
        text: textParts[partIndex] ?? voiceover.text,
        startSeconds: interval.startSeconds,
        endSeconds: interval.endSeconds
      });
      nextBeats.push({
        ...beat,
        id: beatId,
        title: hasMultipleParts ? `${beat.title} ${partIndex + 1}` : beat.title,
        voiceoverSegmentId: voiceoverId
      });
      nextPlannedShots.push({
        ...shot,
        id: shotId,
        beatId,
        startSeconds: interval.startSeconds,
        endSeconds: interval.endSeconds,
        visual: hasMultipleParts
          ? `${shot.visual} Continuation ${partIndex + 1} of ${intervals.length}, same scene and continuity.`
          : shot.visual
      });
    });
  }

  plan.voiceoverSegments = nextVoiceoverSegments;
  plan.beats = nextBeats;
  plan.plannedShots = nextPlannedShots;
  return true;
}

function splitInterval(
  startSeconds: number,
  endSeconds: number,
  maxDurationSeconds: number
): Array<{ startSeconds: number; endSeconds: number }> {
  const durationSeconds = endSeconds - startSeconds;
  const partCount = Math.max(1, Math.ceil(durationSeconds / maxDurationSeconds));

  return Array.from({ length: partCount }, (_value, index) => ({
    startSeconds: index === 0
      ? roundSeconds(startSeconds)
      : roundSeconds(startSeconds + (durationSeconds * index) / partCount),
    endSeconds: index === partCount - 1
      ? roundSeconds(endSeconds)
      : roundSeconds(startSeconds + (durationSeconds * (index + 1)) / partCount)
  }));
}

function splitText(text: string, partCount: number): string[] {
  if (partCount <= 1) {
    return [text];
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < partCount) {
    return Array.from({ length: partCount }, (_value, index) => {
      return index === 0 ? text : `Continue: ${text}`;
    });
  }

  return Array.from({ length: partCount }, (_value, index) => {
    const start = Math.floor((words.length * index) / partCount);
    const end = Math.floor((words.length * (index + 1)) / partCount);
    return words.slice(start, end).join(" ");
  });
}

function formatPipelineId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

async function resolveGeneratedShots(
  rootDir: string,
  project: DirectorMvpProject,
  manifest: ShotManifest,
  dependencies: DirectorMvpPipelineDependencies
): Promise<Map<string, string>> {
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

  return resolvedClipPaths;
}

async function normalizeShots(
  rootDir: string,
  project: DirectorMvpProject,
  manifest: ShotManifest,
  resolvedClipPaths: Map<string, string>,
  dependencies: DirectorMvpPipelineDependencies
): Promise<string[]> {
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

  return normalizedPaths;
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export async function runDirectorMvp(
  rootDir: string,
  briefPath: string,
  dependencies: DirectorMvpPipelineDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  const brief = await readBrief(resolveBriefPath(rootDir, briefPath));
  const project = await openProject(rootDir, brief);
  const planResult = await readOrCreateVideoPlan(project, brief, dependencies);
  let plan = planResult.plan;
  let planWasRefreshed = planResult.refreshed;

  if (shouldRefreshVideoPlan(plan, brief)) {
    plan = await createPlannedVideoPlan(brief, dependencies);
    planWasRefreshed = true;
    await writeJson(project.planPath, plan);
  }

  if (splitLongPlanShots(plan, maxGenerationDurationSeconds(plan.generationDefaults.model))) {
    planWasRefreshed = true;
    await writeJson(project.planPath, plan);
  }

  await writeTextFile(project.scriptPath, videoPlanToScriptMarkdown(plan));

  let manifest: ShotManifest;
  if (planWasRefreshed) {
    const existingManifest = await fileExists(project.manifestPath)
      ? await readShotManifest(project.manifestPath)
      : undefined;
    manifest = existingManifest
      ? mergeExistingGeneratedShotState(compileShotManifest(plan), existingManifest)
      : compileShotManifest(plan);
    await writeJson(project.manifestPath, manifest);
  } else {
    manifest = await readOrCreateShotManifest(project, plan);
  }

  const voiceover = await ensureVoiceover(rootDir, project, brief, plan, dependencies);
  alignPlanAndManifestToVoiceoverDuration(plan, manifest, voiceover);
  if (voiceover.timelineAdjusted) {
    await writeJson(project.planPath, plan);
    await writeTextFile(project.scriptPath, videoPlanToScriptMarkdown(plan));
    await writeJson(project.manifestPath, manifest);
  }

  const resolvedClipPaths = await resolveGeneratedShots(rootDir, project, manifest, dependencies);
  const normalizedPaths = await normalizeShots(rootDir, project, manifest, resolvedClipPaths, dependencies);

  const concatListPath = join(project.projectDir, "work", "concat.txt");
  await writeConcatList(concatListPath, normalizedPaths);

  const srtPath = join(project.projectDir, "exports", `${project.slug}.srt`);
  await writeTextFile(srtPath, shotsToSrt(manifest.shots));

  const burnSubtitles = await dependencies.ffmpegSupportsFilter("subtitles");

  for (const target of EXPORT_TARGETS) {
    const exportPath = join(project.projectDir, "exports", `${project.slug}-${target.suffix}.mp4`);
    await dependencies.runFfmpeg(
      buildRenderWithVoiceoverArgs({
        concatListPath,
        srtPath,
        voiceoverPath: voiceover.path,
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

  const creativeQaReport = validateCreativeQa({ plan, manifest, voiceoverPath: voiceover.path, voiceover });
  await writeCreativeQaReport(join(project.projectDir, "reports", "creative-qa.json"), creativeQaReport);
}
