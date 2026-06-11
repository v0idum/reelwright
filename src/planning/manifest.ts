import type {
  Shot,
  ShotManifest,
  VoiceoverSegment
} from "../domain/schemas.js";
import type {
  PlannedShot,
  VideoPlan
} from "./director.js";
import { maxGenerationDurationSeconds } from "./generation-limits.js";

export function compileShotManifest(plan: VideoPlan): ShotManifest {
  const totalDurationSeconds = plan.voiceoverSegments.at(-1)?.endSeconds ?? plan.targetDurationSeconds;

  return {
    project: plan.project,
    totalDurationSeconds,
    shots: plan.plannedShots.map((shot) => compileShot(plan, shot))
  };
}

function compileShot(plan: VideoPlan, plannedShot: PlannedShot): Shot {
  const durationSeconds = plannedShot.endSeconds - plannedShot.startSeconds;
  const maxDurationSeconds = maxGenerationDurationSeconds(plan.generationDefaults.model);
  if (durationSeconds > maxDurationSeconds) {
    throw new Error(
      `${plannedShot.id} durationSeconds must be <= ${maxDurationSeconds} for ${plan.generationDefaults.model}`
    );
  }

  const scene = plan.scenes.find((candidate) => candidate.id === plannedShot.sceneId);
  const voiceover = findVoiceoverForShot(plan, plannedShot);

  return {
    id: plannedShot.id,
    scene: scene?.title ?? plannedShot.sceneId,
    durationSeconds,
    aspectRatio: "16:9",
    model: plan.generationDefaults.model,
    prompt: buildPrompt(plan, plannedShot),
    sourceMedia: buildSourceMedia(plan, plannedShot),
    narration: voiceover.text,
    captionText: voiceover.text,
    musicCue: "",
    sfx: [],
    status: "planned",
    chapterId: plannedShot.chapterId,
    sceneId: plannedShot.sceneId,
    beatId: plannedShot.beatId,
    shotRole: plannedShot.shotRole,
    continuityId: plannedShot.continuityId,
    voiceoverStartSeconds: plannedShot.startSeconds,
    voiceoverEndSeconds: plannedShot.endSeconds,
    generation: buildGeneration(plan, plannedShot),
    rejectedTakes: []
  };
}

function buildGeneration(plan: VideoPlan, plannedShot: PlannedShot): Shot["generation"] {
  return {
    resolution: plan.generationDefaults.resolution,
    ...(plannedShot.startImage ? { startImage: plannedShot.startImage } : {}),
    ...(plannedShot.endImage ? { endImage: plannedShot.endImage } : {})
  };
}

function buildPrompt(plan: VideoPlan, shot: PlannedShot): string {
  const anchor = plan.continuityAnchors.find((candidate) => candidate.id === shot.continuityId)
    ?? plan.continuityAnchors[0];
  const continuityAnchor = anchor
    ? `${anchor.id}: ${anchor.description}`
    : shot.continuityId;
  const palette = anchor?.rules.join("; ") || anchor?.description || "coherent cinematic palette";
  const brandStyle = plan.brandStyle.length
    ? `Brand/style rules: ${plan.brandStyle.join("; ")}.`
    : "";
  const assets = plan.assets.length
    ? `Reference assets: ${plan.assets.map(formatAsset).join("; ")}.`
    : "";
  const safetyRules = plan.promptSafetyRules.length
    ? plan.promptSafetyRules.join(", ")
    : "No text, no logos, no celebrity likeness, no real public figures.";

  return [
    `${plan.visualStyle}. Same coherent world: ${continuityAnchor}.`,
    `Continuity mode: ${plan.continuityMode}.`,
    `Palette: ${palette}.`,
    brandStyle,
    assets,
    `Camera: ${shot.camera}.`,
    `Shot role: ${shot.shotRole}.`,
    `${shot.visual}.`,
    safetyRules
  ].filter(Boolean).join(" ");
}

function formatAsset(asset: VideoPlan["assets"][number]): string {
  return [
    `${asset.id} (${asset.kind})`,
    asset.path,
    asset.description,
    asset.usage
  ].filter(Boolean).join(": ");
}

function buildSourceMedia(plan: VideoPlan, plannedShot: PlannedShot): string[] {
  const values = [
    plannedShot.startImage,
    plannedShot.endImage,
    ...plan.assets.map((asset) => asset.path)
  ].filter((value): value is string => Boolean(value));

  return [...new Set(values)];
}

function findVoiceoverForShot(plan: VideoPlan, shot: PlannedShot): VoiceoverSegment {
  const beat = plan.beats.find((candidate) => candidate.id === shot.beatId);
  const voiceover = plan.voiceoverSegments.find((segment) => {
    return segment.id === beat?.voiceoverSegmentId;
  });

  if (!voiceover) {
    throw new Error(`No voiceover segment found for ${shot.id}`);
  }

  return voiceover;
}
