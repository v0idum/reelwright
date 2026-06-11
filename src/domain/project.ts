import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BriefSchema } from "./schemas.js";
import type { Brief, ParsedBrief, ShotManifest, StoryBible } from "./schemas.js";

export type CreatedProject = {
  slug: string;
  projectDir: string;
  storyBiblePath: string;
  manifestPath: string;
};

type PlannedShot = readonly [
  id: string,
  scene: string,
  durationSeconds: number,
  shotPrompt: string,
  captionText: string
];

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || "project";
}

export async function readBrief(path: string): Promise<ParsedBrief> {
  const raw = await readFile(path, "utf8");
  return BriefSchema.parse(JSON.parse(raw));
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function createProject(rootDir: string, brief: Brief): Promise<CreatedProject> {
  const slug = slugify(brief.topic);
  const projectDir = join(rootDir, "projects", slug);
  const storyBiblePath = join(projectDir, "story-bible.json");
  const manifestPath = join(projectDir, "shot-manifest.json");

  await mkdir(join(projectDir, "media", "raw"), { recursive: true });
  await mkdir(join(projectDir, "media", "generated"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await mkdir(join(projectDir, "reports"), { recursive: true });

  const storyBible: StoryBible = {
    visualStyle: "Cinematic macro visuals, quick contrast shifts, high contrast detail, no copyrighted UI logos.",
    pacingRules: [
      "Open with immediate motion.",
      "Cut every 6-10 seconds.",
      "Every shot must carry one useful idea."
    ],
    captionStyle: "Large, high-contrast creator captions with short sharp phrases.",
    brandRules: [
      "No brand marks or copyrighted app logos in generated visuals.",
      "No celebrity likeness or real public figure references.",
      "No medical claims or diagnostic language."
    ],
    characterRules: [
      "Use abstract hands, silhouettes, or non-identifiable characters only.",
      "Avoid recreating any real person's face or likeness."
    ],
    locationRules: [
      "Modern studio surfaces, phone-lit rooms, and abstract attention-economy environments.",
      "Keep environments cinematic, minimal, and free of recognizable platform branding."
    ],
    promptTemplate: "{visualStyle}. {shotPrompt}. No text, no logos, no celebrity likeness, cinematic lighting, high-quality social video.",
    negativePromptRules: [
      "No app logos.",
      "No celebrity likeness.",
      "No real public figures.",
      "No medical diagnosis language.",
      "No visible text or watermark."
    ]
  };

  const plannedShots: readonly PlannedShot[] = [
    [
      "shot-001",
      "Hook",
      8,
      "A glowing phone pulls a viewer into a tunnel of rapid vertical video frames",
      "Short videos are engineered to win the first second."
    ],
    [
      "shot-002",
      "Variable reward",
      8,
      "A cinematic macro scene of shuffled cards transforming into video thumbnails and notification lights",
      "The next swipe might be boring, or perfect."
    ],
    [
      "shot-003",
      "Pacing",
      8,
      "A fast visual metronome cuts between captions, jump cuts, and close-up reaction silhouettes",
      "Fast pacing resets attention before it drifts."
    ],
    [
      "shot-004",
      "Creator lesson",
      8,
      "A clean creator desk with timeline blocks snapping into a tight sequence",
      "Strong videos stack hook, payoff, and motion."
    ],
    [
      "shot-005",
      "CTA",
      7,
      "A premium end frame with abstract waveform, editing timeline, and bright caption space",
      "Use the format intentionally, not accidentally."
    ]
  ];

  const manifest: ShotManifest = {
    project: slug,
    totalDurationSeconds: plannedShots.reduce((sum, shot) => sum + shot[2], 0),
    shots: plannedShots.map(([id, scene, durationSeconds, shotPrompt, captionText]) => ({
      id,
      scene,
      durationSeconds,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: `${storyBible.visualStyle} ${shotPrompt}. No text, no logos, no celebrity likeness, cinematic, high-quality social video.`,
      sourceMedia: [],
      narration: captionText,
      captionText,
      musicCue: "Fast electronic pulse.",
      sfx: [],
      status: "planned",
      rejectedTakes: []
    }))
  };

  await writeJson(storyBiblePath, storyBible);
  await writeJson(manifestPath, manifest);

  return { slug, projectDir, storyBiblePath, manifestPath };
}
