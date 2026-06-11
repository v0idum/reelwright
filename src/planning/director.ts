import { z } from "zod";
import type {
  Brief,
  BriefAsset,
  ContinuityMode,
  GenerationDefaults,
  Platform,
  PlatformPackage,
  VideoType,
  VoiceoverSegment
} from "../domain/schemas.js";
import {
  BriefAssetSchema,
  ContinuityModeSchema,
  GenerationDefaultsSchema,
  PlatformPackageSchema,
  PlatformSchema,
  VideoTypeSchema,
  VoiceoverSegmentSchema
} from "../domain/schemas.js";
import {
  type DirectorBeatTemplate,
  type DirectorTemplate,
  selectDirectorTemplate
} from "./templates.js";

export type ShotRole = "hook" | "explain" | "proof" | "transition" | "cta" | "broll";

export type ContinuityAnchor = {
  id: string;
  description: string;
  rules: string[];
};

export type VideoChapter = {
  id: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
};

export type VideoScene = {
  id: string;
  chapterId: string;
  title: string;
  purpose: string;
  startSeconds: number;
  endSeconds: number;
};

export type VideoBeat = {
  id: string;
  sceneId: string;
  title: string;
  voiceoverSegmentId: string;
};

export type PlannedShot = {
  id: string;
  chapterId: string;
  sceneId: string;
  beatId: string;
  shotRole: ShotRole;
  continuityId: string;
  startSeconds: number;
  endSeconds: number;
  visual: string;
  camera: string;
  startImage?: string;
  endImage?: string;
};

export type VideoPlan = {
  project: string;
  topic: string;
  videoType: VideoType;
  primaryGoal?: string;
  productOrOffer?: string;
  targetDurationSeconds: number;
  speaker: string;
  audience: string;
  platforms: Platform[];
  language: string;
  tone: string;
  cta: string;
  brandStyle: string[];
  continuityMode: ContinuityMode;
  platformPackage: PlatformPackage;
  assets: BriefAsset[];
  visualStyle: string;
  promptSafetyRules: string[];
  generationDefaults: GenerationDefaults;
  continuityAnchors: ContinuityAnchor[];
  chapters: VideoChapter[];
  scenes: VideoScene[];
  beats: VideoBeat[];
  voiceoverSegments: VoiceoverSegment[];
  plannedShots: PlannedShot[];
};

type TimedBeat = {
  template: DirectorBeatTemplate;
  durationSeconds: number;
  partIndex: number;
  partCount: number;
};

const DEFAULT_GENERATION_DEFAULTS: GenerationDefaults = {
  model: "kling3_0",
  resolution: "720p"
};

const DEFAULT_PROMPT_SAFETY_RULES = [
  "No text",
  "no logos",
  "no celebrity likeness",
  "no real public figures",
  "cinematic social video"
];

const ShotRoleSchema = z.enum(["hook", "explain", "proof", "transition", "cta", "broll"]);

const ContinuityAnchorSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  rules: z.array(z.string().min(1))
});

const VideoChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive()
});

const VideoSceneSchema = VideoChapterSchema.extend({
  chapterId: z.string().min(1),
  purpose: z.string()
});

const VideoBeatSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  title: z.string().min(1),
  voiceoverSegmentId: z.string().min(1)
});

const PlannedShotSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  sceneId: z.string().min(1),
  beatId: z.string().min(1),
  shotRole: ShotRoleSchema,
  continuityId: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  visual: z.string().min(1),
  camera: z.string().min(1),
  startImage: z.string().min(1).optional(),
  endImage: z.string().min(1).optional()
});

const VideoPlanBaseSchema = z.object({
  project: z.string().min(1),
  topic: z.string().min(1),
  videoType: VideoTypeSchema,
  primaryGoal: z.string().min(1).optional(),
  productOrOffer: z.string().min(1).optional(),
  targetDurationSeconds: z.number().positive(),
  speaker: z.string().min(1),
  audience: z.string().min(1),
  platforms: z.array(PlatformSchema).min(1),
  language: z.string().min(1),
  tone: z.string().min(1),
  cta: z.string().min(1),
  brandStyle: z.array(z.string().min(1)),
  continuityMode: ContinuityModeSchema,
  platformPackage: PlatformPackageSchema,
  assets: z.array(BriefAssetSchema),
  visualStyle: z.string().min(1),
  promptSafetyRules: z.array(z.string().min(1)),
  generationDefaults: GenerationDefaultsSchema,
  continuityAnchors: z.array(ContinuityAnchorSchema).min(1),
  chapters: z.array(VideoChapterSchema).min(1),
  scenes: z.array(VideoSceneSchema).min(1),
  beats: z.array(VideoBeatSchema).min(1),
  voiceoverSegments: z.array(VoiceoverSegmentSchema).min(1),
  plannedShots: z.array(PlannedShotSchema).min(1)
});

export const VideoPlanSchema = VideoPlanBaseSchema.superRefine((plan, context) => {
  const chapterIds = new Set(plan.chapters.map((chapter) => chapter.id));
  const sceneIds = new Set(plan.scenes.map((scene) => scene.id));
  const beatIds = new Set(plan.beats.map((beat) => beat.id));
  const voiceoverIds = new Set(plan.voiceoverSegments.map((segment) => segment.id));
  const continuityIds = new Set(plan.continuityAnchors.map((anchor) => anchor.id));

  plan.scenes.forEach((scene, index) => {
    if (!chapterIds.has(scene.chapterId)) {
      context.addIssue({
        code: "custom",
        path: ["scenes", index, "chapterId"],
        message: `scene ${scene.id} references missing chapter ${scene.chapterId}`
      });
    }
  });

  plan.beats.forEach((beat, index) => {
    if (!sceneIds.has(beat.sceneId)) {
      context.addIssue({
        code: "custom",
        path: ["beats", index, "sceneId"],
        message: `beat ${beat.id} references missing scene ${beat.sceneId}`
      });
    }
    if (!voiceoverIds.has(beat.voiceoverSegmentId)) {
      context.addIssue({
        code: "custom",
        path: ["beats", index, "voiceoverSegmentId"],
        message: `beat ${beat.id} references missing voiceover segment ${beat.voiceoverSegmentId}`
      });
    }
  });

  plan.voiceoverSegments.forEach((segment, index) => {
    if (segment.endSeconds <= segment.startSeconds) {
      context.addIssue({
        code: "custom",
        path: ["voiceoverSegments", index, "endSeconds"],
        message: `voiceover segment ${segment.id} must end after it starts`
      });
    }
  });

  plan.plannedShots.forEach((shot, index) => {
    const durationSeconds = shot.endSeconds - shot.startSeconds;
    if (durationSeconds <= 0 || durationSeconds > 30) {
      context.addIssue({
        code: "custom",
        path: ["plannedShots", index, "endSeconds"],
        message: `planned shot ${shot.id} duration must be > 0 and <= 30 seconds`
      });
    }
    if (!chapterIds.has(shot.chapterId)) {
      context.addIssue({
        code: "custom",
        path: ["plannedShots", index, "chapterId"],
        message: `planned shot ${shot.id} references missing chapter ${shot.chapterId}`
      });
    }
    if (!sceneIds.has(shot.sceneId)) {
      context.addIssue({
        code: "custom",
        path: ["plannedShots", index, "sceneId"],
        message: `planned shot ${shot.id} references missing scene ${shot.sceneId}`
      });
    }
    if (!beatIds.has(shot.beatId)) {
      context.addIssue({
        code: "custom",
        path: ["plannedShots", index, "beatId"],
        message: `planned shot ${shot.id} references missing beat ${shot.beatId}`
      });
    }
    if (!continuityIds.has(shot.continuityId)) {
      context.addIssue({
        code: "custom",
        path: ["plannedShots", index, "continuityId"],
        message: `planned shot ${shot.id} references missing continuity anchor ${shot.continuityId}`
      });
    }
  });
});

export function parseVideoPlan(value: unknown): VideoPlan {
  return VideoPlanSchema.parse(value);
}

export function createVideoPlan(brief: Brief): VideoPlan {
  const template = selectDirectorTemplate(brief);
  const targetDurationSeconds = brief.targetDurationSeconds ?? template.baseTargetSeconds;
  const generationDefaults = {
    ...DEFAULT_GENERATION_DEFAULTS,
    ...brief.generationDefaults
  };
  const brandStyle = brief.brandStyle ?? [];
  const assets = brief.assets ?? [];
  const continuityRules = buildContinuityRules(brief, template, brandStyle);
  const timedBeats = buildTimedBeats(template, targetDurationSeconds);
  const sceneIds = sceneIdsByTitle(timedBeats);
  const voiceoverSegments = buildVoiceoverSegments(brief, timedBeats);
  const scenes = buildScenes(timedBeats, sceneIds, voiceoverSegments);
  const beats = timedBeats.map((timedBeat, index) => ({
    id: formatId("beat", index + 1),
    sceneId: sceneIds.get(timedBeat.template.sceneTitle) ?? formatId("scene", index + 1),
    title: beatTitle(timedBeat),
    voiceoverSegmentId: voiceoverSegments[index].id
  }));
  const plannedShots = timedBeats.map((timedBeat, index) => ({
    id: formatId("shot", index + 1),
    chapterId: "chapter-001",
    sceneId: sceneIds.get(timedBeat.template.sceneTitle) ?? formatId("scene", index + 1),
    beatId: formatId("beat", index + 1),
    shotRole: timedBeat.template.role,
    continuityId: template.continuityId,
    startSeconds: voiceoverSegments[index].startSeconds,
    endSeconds: voiceoverSegments[index].endSeconds,
    visual: timedBeatVisual(brief, timedBeat),
    camera: timedBeat.template.camera
  }));

  return {
    project: slugify(brief.topic),
    topic: brief.topic,
    videoType: brief.videoType ?? template.id,
    primaryGoal: brief.primaryGoal,
    productOrOffer: brief.productOrOffer,
    targetDurationSeconds,
    speaker: `${brief.tone} narrator`,
    audience: brief.audience,
    platforms: brief.platforms,
    language: brief.language,
    tone: brief.tone,
    cta: brief.cta,
    brandStyle,
    continuityMode: brief.continuityMode ?? "style",
    platformPackage: brief.platformPackage ?? "standard_social",
    assets,
    visualStyle: template.visualStyle,
    promptSafetyRules: buildPromptSafetyRules(brief),
    generationDefaults,
    continuityAnchors: [{
      id: template.continuityId,
      description: continuityRules.join("; "),
      rules: continuityRules
    }],
    chapters: [{
      id: "chapter-001",
      title: template.chapterTitle,
      startSeconds: 0,
      endSeconds: targetDurationSeconds
    }],
    scenes,
    beats,
    voiceoverSegments,
    plannedShots
  };
}

export function videoPlanToScriptMarkdown(plan: VideoPlan): string {
  const lines = [
    `# ${plan.topic}`,
    "",
    `Project: ${plan.project}`,
    `Target duration: ${plan.targetDurationSeconds}s`,
    `Speaker: ${plan.speaker}`,
    `Video type: ${plan.videoType}`,
    ""
  ];

  plan.chapters.forEach((chapter, chapterIndex) => {
    lines.push(`## Chapter ${chapterIndex + 1}: ${chapter.title}`, "");

    plan.scenes
      .filter((scene) => scene.chapterId === chapter.id)
      .forEach((scene, sceneIndex) => {
        lines.push(`### Scene ${sceneIndex + 1}: ${scene.title}`);
        lines.push(`${scene.startSeconds}-${scene.endSeconds}s - ${scene.purpose}`);
        lines.push("");

        plan.plannedShots
          .filter((shot) => shot.sceneId === scene.id)
          .forEach((shot) => {
            const beat = plan.beats.find((candidate) => candidate.id === shot.beatId);
            const voiceover = plan.voiceoverSegments.find((segment) => {
              return segment.id === beat?.voiceoverSegmentId;
            });
            lines.push(`- ${shot.id} [${shot.shotRole}] ${shot.startSeconds}-${shot.endSeconds}s`);
            lines.push(`  - Visual: ${shot.visual}`);
            if (voiceover) {
              lines.push(`  - Voiceover: ${voiceover.text}`);
            }
          });

        lines.push("");
      });
  });

  return lines.join("\n").trimEnd() + "\n";
}

function buildVoiceoverSegments(
  brief: Brief,
  timedBeats: TimedBeat[]
): VoiceoverSegment[] {
  let startSeconds = 0;

  return timedBeats.map((timedBeat, index) => {
    const endSeconds = startSeconds + timedBeat.durationSeconds;
    const segment = {
      id: formatId("vo", index + 1),
      text: timedBeatText(brief, timedBeat),
      startSeconds,
      endSeconds
    };
    startSeconds = endSeconds;
    return segment;
  });
}

function buildScenes(
  timedBeats: TimedBeat[],
  sceneIds: Map<string, string>,
  voiceoverSegments: VoiceoverSegment[]
): VideoScene[] {
  const sceneOrder = [...sceneIds.keys()];

  return sceneOrder.map((title) => {
    const beatIndexes = timedBeats
      .map((timedBeat, index) => ({ timedBeat, index }))
      .filter(({ timedBeat }) => timedBeat.template.sceneTitle === title)
      .map(({ index }) => index);
    const firstIndex = beatIndexes[0] ?? 0;
    const lastIndex = beatIndexes.at(-1) ?? firstIndex;
    const templateBeat = timedBeats[firstIndex]?.template;

    return {
      id: sceneIds.get(title) ?? formatId("scene", firstIndex + 1),
      chapterId: "chapter-001",
      title,
      purpose: templateBeat?.scenePurpose ?? "",
      startSeconds: voiceoverSegments[firstIndex].startSeconds,
      endSeconds: voiceoverSegments[lastIndex].endSeconds
    };
  });
}

function sceneIdsByTitle(timedBeats: TimedBeat[]): Map<string, string> {
  const sceneIds = new Map<string, string>();

  timedBeats.forEach((timedBeat) => {
    if (!sceneIds.has(timedBeat.template.sceneTitle)) {
      sceneIds.set(timedBeat.template.sceneTitle, formatId("scene", sceneIds.size + 1));
    }
  });

  return sceneIds;
}

function buildTimedBeats(template: DirectorTemplate, targetDurationSeconds: number): TimedBeat[] {
  const durations = scaleDurations(template.baseDurations, template.baseTargetSeconds, targetDurationSeconds);

  return template.beats.flatMap((beat, index) => {
    return splitDuration(durations[index]).map((durationSeconds, partIndex, parts) => ({
      template: beat,
      durationSeconds,
      partIndex,
      partCount: parts.length
    }));
  });
}

function splitDuration(durationSeconds: number): number[] {
  const partCount = Math.max(1, Math.ceil(durationSeconds / 30));
  const baseDuration = Math.floor(durationSeconds / partCount);
  let remainder = durationSeconds - (baseDuration * partCount);

  return Array.from({ length: partCount }, () => {
    const duration = baseDuration + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return duration;
  });
}

function beatTitle(timedBeat: TimedBeat): string {
  if (timedBeat.partCount === 1) {
    return timedBeat.template.beatTitle;
  }

  return `${timedBeat.template.beatTitle} ${timedBeat.partIndex + 1}`;
}

function timedBeatText(brief: Brief, timedBeat: TimedBeat): string {
  if (timedBeat.partIndex === 0) {
    return timedBeat.template.text(brief);
  }

  if (/^(ru|rus|russian|рус)/i.test(brief.language)) {
    return `Продолжите мысль "${timedBeat.template.beatTitle.toLowerCase()}" на примере темы "${brief.topic}", сохраняя практичный сценарий и понятный переход к следующему шагу.`;
  }

  return `Continue the "${timedBeat.template.beatTitle.toLowerCase()}" point with a concrete supporting example for ${brief.topic}, keeping the same practical scenario and a clear transition to the next step.`;
}

function timedBeatVisual(brief: Brief, timedBeat: TimedBeat): string {
  const visual = timedBeat.template.visual(brief);
  if (timedBeat.partCount === 1) {
    return visual;
  }

  return `${visual} Continuation ${timedBeat.partIndex + 1} of ${timedBeat.partCount}, with a distinct camera moment in the same scene.`;
}

function buildContinuityRules(
  brief: Brief,
  template: DirectorTemplate,
  brandStyle: string[]
): string[] {
  if (brief.visualContinuity?.length) {
    return brief.visualContinuity;
  }

  return [...template.defaultContinuity, ...brandStyle];
}

function buildPromptSafetyRules(brief: Brief): string[] {
  const constraints = brief.constraints ?? [];
  return [...DEFAULT_PROMPT_SAFETY_RULES, ...constraints];
}

function scaleDurations(
  baseDurations: number[],
  baseTargetSeconds: number,
  targetDurationSeconds: number
): number[] {
  if (targetDurationSeconds === baseTargetSeconds) {
    return [...baseDurations];
  }

  const scaled = baseDurations.map((duration) => {
    return Math.max(1, Math.round((duration / baseTargetSeconds) * targetDurationSeconds));
  });
  const totalBeforeCorrection = scaled.reduce((sum, duration) => sum + duration, 0);
  scaled[scaled.length - 1] += targetDurationSeconds - totalBeforeCorrection;

  if (scaled[scaled.length - 1] < 1) {
    scaled[scaled.length - 1] = 1;
  }

  return scaled;
}

function formatId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "director-plan";
}
