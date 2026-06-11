import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "shorts", "instagram", "tiktok"]);
export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:5"]);
export const ShotStatusSchema = z.enum(["planned", "generated", "rejected", "assembled"]);
export const VideoTypeSchema = z.enum([
  "explainer",
  "guide",
  "tutorial",
  "promo_ad",
  "product_demo",
  "story_episode",
  "ugc_ad",
  "documentary_short",
  "social_short"
]);
export const ContinuityModeSchema = z.enum(["none", "style", "brand", "character", "world"]);
export const PlatformPackageSchema = z.enum([
  "standard_social",
  "youtube_long",
  "shorts_reels",
  "campaign_pack"
]);
export const AssetKindSchema = z.enum([
  "logo",
  "product",
  "reference",
  "character",
  "location",
  "music",
  "sfx"
]);
export const GenerationDefaultsSchema = z.object({
  model: z.string().min(1).default("kling3_0"),
  resolution: z.string().min(1).default("720p")
});

export const BriefAssetSchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  path: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  usage: z.string().min(1).optional()
});

export const PlanningConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template").default("template")
  }),
  z.object({
    mode: z.literal("local_llm"),
    provider: z.enum(["ollama", "lm_studio"]),
    model: z.string().min(1),
    endpoint: z.string().url().optional(),
    temperature: z.number().min(0).max(2).default(0.4)
  })
]);

export const VoiceoverConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("provided_audio"),
    audioPath: z.string().min(1)
  }),
  z.object({
    mode: z.literal("local_tts"),
    engine: z.literal("mlx_audio").default("mlx_audio"),
    model: z.string().min(1).default("mlx-community/Kokoro-82M-4bit"),
    voice: z.string().min(1).default("af_heart"),
    speed: z.number().positive().default(1.05),
    langCode: z.string().min(1).default("a"),
    audioFormat: z.literal("wav").default("wav")
  }),
  z.object({
    mode: z.literal("local_placeholder"),
    voice: z.string().min(1).optional()
  })
]);

export const ShotGenerationSchema = z.object({
  resolution: z.string().min(1).default("720p"),
  startImage: z.string().min(1).optional(),
  endImage: z.string().min(1).optional(),
  promptStrength: z.number().positive().optional()
});

export const VoiceoverSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive()
});

export const BriefSchema = z.object({
  topic: z.string().min(3),
  audience: z.string().min(2),
  platforms: z.array(PlatformSchema).min(1),
  language: z.string().min(2),
  tone: z.string().min(2),
  cta: z.string().min(1),
  targetDurationSeconds: z.number().positive().optional(),
  videoType: VideoTypeSchema.default("explainer"),
  primaryGoal: z.string().min(1).optional(),
  productOrOffer: z.string().min(1).optional(),
  brandStyle: z.array(z.string().min(1)).default([]),
  continuityMode: ContinuityModeSchema.default("style"),
  assets: z.array(BriefAssetSchema).default([]),
  platformPackage: PlatformPackageSchema.default("standard_social"),
  planning: PlanningConfigSchema.default({ mode: "template" }),
  generationDefaults: GenerationDefaultsSchema.optional(),
  voiceover: VoiceoverConfigSchema.optional(),
  visualContinuity: z.array(z.string()).optional(),
  styleReferences: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([])
});

export const StoryBibleSchema = z.object({
  visualStyle: z.string(),
  pacingRules: z.array(z.string()),
  captionStyle: z.string(),
  brandRules: z.array(z.string()),
  characterRules: z.array(z.string()),
  locationRules: z.array(z.string()),
  promptTemplate: z.string(),
  negativePromptRules: z.array(z.string())
});

export const ShotSchema = z.object({
  id: z.string().min(1),
  scene: z.string().min(1),
  durationSeconds: z.number().positive().max(30),
  aspectRatio: AspectRatioSchema,
  model: z.string().min(1),
  prompt: z.string().min(10),
  sourceMedia: z.array(z.string()).default([]),
  narration: z.string().min(1),
  captionText: z.string().min(1),
  musicCue: z.string().default(""),
  sfx: z.array(z.string()).default([]),
  status: ShotStatusSchema,
  chapterId: z.string().min(1).optional(),
  sceneId: z.string().min(1).optional(),
  beatId: z.string().min(1).optional(),
  shotRole: z.enum(["hook", "explain", "proof", "transition", "cta", "broll"]).optional(),
  continuityId: z.string().min(1).optional(),
  voiceoverStartSeconds: z.number().nonnegative().optional(),
  voiceoverEndSeconds: z.number().nonnegative().optional(),
  generation: ShotGenerationSchema.optional(),
  higgsfieldJobId: z.string().optional(),
  outputUrl: z.string().url().optional(),
  localPath: z.string().optional(),
  rejectedTakes: z.array(z.string()).default([])
});

export const ShotManifestSchema = z.object({
  project: z.string().min(1),
  totalDurationSeconds: z.number().positive(),
  shots: z.array(ShotSchema).min(1)
});

export const QaIssueSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string()
});

export const QaReportSchema = z.object({
  exportPath: z.string(),
  expectedWidth: z.number().int().positive(),
  expectedHeight: z.number().int().positive(),
  actualWidth: z.number().int().positive().optional(),
  actualHeight: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  issues: z.array(QaIssueSchema)
});

export type Brief = z.input<typeof BriefSchema>;
export type ParsedBrief = z.infer<typeof BriefSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type ShotStatus = z.infer<typeof ShotStatusSchema>;
export type VideoType = z.infer<typeof VideoTypeSchema>;
export type ContinuityMode = z.infer<typeof ContinuityModeSchema>;
export type PlatformPackage = z.infer<typeof PlatformPackageSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type BriefAsset = z.infer<typeof BriefAssetSchema>;
export type PlanningConfig = z.infer<typeof PlanningConfigSchema>;
export type GenerationDefaults = z.infer<typeof GenerationDefaultsSchema>;
export type VoiceoverConfig = z.infer<typeof VoiceoverConfigSchema>;
export type ShotGeneration = z.infer<typeof ShotGenerationSchema>;
export type VoiceoverSegment = z.infer<typeof VoiceoverSegmentSchema>;
export type StoryBible = z.infer<typeof StoryBibleSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type ShotManifest = z.infer<typeof ShotManifestSchema>;
export type QaIssue = z.infer<typeof QaIssueSchema>;
export type QaReport = z.infer<typeof QaReportSchema>;
