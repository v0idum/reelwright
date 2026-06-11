import test from "node:test";
import assert from "node:assert/strict";
import {
  BriefSchema,
  ShotManifestSchema,
  VoiceoverSegmentSchema
} from "../src/domain/schemas.js";

test("BriefSchema accepts the MVP brief shape", () => {
  const brief = BriefSchema.parse({
    topic: "Why short-form videos feel addictive",
    audience: "curious creators",
    platforms: ["youtube", "shorts"],
    language: "en",
    tone: "fast, clear, cinematic",
    cta: "Subscribe for sharper video strategy",
    styleReferences: ["creator explainer", "kinetic captions"],
    constraints: ["no real people", "no copyrighted logos"]
  });

  assert.equal(brief.language, "en");
  assert.deepEqual(brief.platforms, ["youtube", "shorts"]);
});

test("BriefSchema accepts director layer v2 fields", () => {
  const brief = BriefSchema.parse({
    topic: "Why short-form videos feel addictive, explained in 75 seconds",
    audience: "founders and creators who want better retention",
    platforms: ["youtube", "shorts"],
    language: "en",
    tone: "sharp, premium, useful",
    cta: "Use Reelwright to turn briefs into consistent video systems",
    targetDurationSeconds: 75,
    generationDefaults: { model: "kling3_0", resolution: "720p" },
    voiceover: { mode: "local_placeholder" },
    visualContinuity: [
      "one dark creator studio",
      "same phone, desk, waveform monitor, and editing timeline motif"
    ],
    styleReferences: ["premium creator explainer"],
    constraints: ["no app logos"]
  });

  assert.equal(brief.targetDurationSeconds, 75);
  assert.deepEqual(brief.generationDefaults, { model: "kling3_0", resolution: "720p" });
  assert.deepEqual(brief.voiceover, { mode: "local_placeholder" });
  assert.deepEqual(brief.visualContinuity, [
    "one dark creator studio",
    "same phone, desk, waveform monitor, and editing timeline motif"
  ]);
});

test("BriefSchema accepts a configured local placeholder voice", () => {
  const brief = BriefSchema.parse({
    topic: "AI agents for service businesses",
    audience: "business owners",
    platforms: ["youtube"],
    language: "en",
    tone: "practical",
    cta: "Start with one repeatable process",
    voiceover: {
      mode: "local_placeholder",
      voice: "Milena"
    }
  });

  assert.deepEqual(brief.voiceover, { mode: "local_placeholder", voice: "Milena" });
});

test("BriefSchema accepts local open-model TTS voiceover config", () => {
  const brief = BriefSchema.parse({
    topic: "Why short-form videos feel addictive, explained in 75 seconds",
    audience: "founders and creators who want better retention",
    platforms: ["youtube", "shorts"],
    language: "en",
    tone: "sharp, premium, useful",
    cta: "Use Reelwright to turn briefs into consistent video systems",
    targetDurationSeconds: 75,
    generationDefaults: { model: "kling3_0", resolution: "720p" },
    voiceover: {
      mode: "local_tts"
    }
  });

  assert.deepEqual(brief.voiceover, {
    mode: "local_tts",
    engine: "mlx_audio",
    model: "mlx-community/Kokoro-82M-4bit",
    voice: "af_heart",
    speed: 1.05,
    langCode: "a",
    audioFormat: "wav"
  });
});

test("BriefSchema accepts universal director v1 fields", () => {
  const brief = BriefSchema.parse({
    topic: "Practical AI agent workflows for service businesses",
    audience: "owners and operators of service businesses",
    platforms: ["youtube", "shorts"],
    language: "en",
    tone: "clear, practical, premium",
    cta: "Choose one repeated process and test whether an AI agent can speed it up this week",
    targetDurationSeconds: 120,
    videoType: "guide",
    primaryGoal: "show realistic business integration paths",
    productOrOffer: "AI video production workflow",
    brandStyle: ["modern service business context", "practical examples over hype"],
    continuityMode: "brand",
    platformPackage: "standard_social",
    assets: [{
      id: "service-business-map",
      kind: "reference",
      description: "Modern service business environment with clean operations dashboards"
    }],
    planning: { mode: "template" },
    generationDefaults: { model: "kling3_0", resolution: "720p" }
  });

  assert.equal(brief.videoType, "guide");
  assert.equal(brief.continuityMode, "brand");
  assert.equal(brief.assets[0]?.id, "service-business-map");
  assert.deepEqual(brief.planning, { mode: "template" });
});

test("ShotManifestSchema accepts director metadata on shots", () => {
  const manifest = ShotManifestSchema.parse({
    project: "director-layer",
    totalDurationSeconds: 75,
    shots: [{
      id: "shot-001",
      scene: "Hook",
      durationSeconds: 8,
      aspectRatio: "9:16",
      model: "kling3_0",
      prompt: "Macro shot of a phone showing a fast-moving timeline in a dark studio.",
      sourceMedia: [],
      narration: "Short videos are engineered around prediction loops.",
      captionText: "Prediction loops",
      musicCue: "",
      sfx: [],
      status: "planned",
      chapterId: "chapter-001",
      sceneId: "scene-001",
      beatId: "beat-001",
      shotRole: "hook",
      continuityId: "studio-phone",
      voiceoverStartSeconds: 0,
      voiceoverEndSeconds: 8,
      generation: { resolution: "720p" }
    }]
  });

  const [shot] = manifest.shots;
  assert.equal(shot.chapterId, "chapter-001");
  assert.equal(shot.sceneId, "scene-001");
  assert.equal(shot.beatId, "beat-001");
  assert.equal(shot.shotRole, "hook");
  assert.equal(shot.continuityId, "studio-phone");
  assert.equal(shot.voiceoverStartSeconds, 0);
  assert.equal(shot.voiceoverEndSeconds, 8);
  assert.deepEqual(shot.generation, { resolution: "720p" });
});

test("ShotManifestSchema still accepts the v1 manifest shape", () => {
  const manifest = ShotManifestSchema.parse({
    project: "mvp",
    totalDurationSeconds: 8,
    shots: [{
      id: "shot-001",
      scene: "Hook",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A cinematic creator explainer opening shot with kinetic motion graphics.",
      narration: "A hook",
      captionText: "A hook",
      status: "planned"
    }]
  });

  assert.equal(manifest.project, "mvp");
  assert.equal(manifest.shots[0].model, "seedance_2_0");
});

test("VoiceoverSegmentSchema rejects zero endSeconds", () => {
  assert.throws(() => {
    VoiceoverSegmentSchema.parse({
      id: "vo-001",
      text: "Opening line",
      startSeconds: 0,
      endSeconds: 0
    });
  }, /endSeconds/);
});

test("ShotManifestSchema rejects shots without prompts", () => {
  assert.throws(() => {
    ShotManifestSchema.parse({
      project: "bad",
      totalDurationSeconds: 8,
      shots: [{
        id: "shot-001",
        scene: "Hook",
        durationSeconds: 8,
        aspectRatio: "16:9",
        model: "seedance_2_0",
        narration: "A hook",
        captionText: "A hook",
        status: "planned",
        rejectedTakes: []
      }]
    });
  }, /prompt/);
});
