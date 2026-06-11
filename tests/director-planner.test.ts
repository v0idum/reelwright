import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BriefSchema } from "../src/domain/schemas.js";
import {
  createVideoPlan,
  videoPlanToScriptMarkdown
} from "../src/planning/director.js";

const sampleBrief = BriefSchema.parse(JSON.parse(readFileSync(
  new URL("../briefs/short-form-addiction-director.json", import.meta.url),
  "utf8"
)));

test("createVideoPlan builds the deterministic 75-second director MVP plan", () => {
  const plan = createVideoPlan(sampleBrief);

  assert.equal(plan.targetDurationSeconds, 75);
  assert.equal(plan.chapters.length, 1);
  assert.equal(plan.chapters[0].id, "chapter-001");
  assert.equal(plan.chapters[0].title, "Why the loop works");
  assert.ok(plan.plannedShots.length >= 6);
  assert.ok(plan.plannedShots.length <= 9);
  assert.deepEqual(plan.generationDefaults, {
    model: "kling3_0",
    resolution: "720p"
  });

  assert.ok(plan.continuityAnchors.some((anchor) => {
    return anchor.id === "creator-studio-attention-loop";
  }));
  assert.ok(plan.plannedShots.every((shot) => {
    return shot.continuityId === "creator-studio-attention-loop";
  }));
  assert.ok(plan.plannedShots.every((shot) => {
    return plan.scenes.some((scene) => scene.id === shot.sceneId)
      && plan.beats.some((beat) => beat.id === shot.beatId);
  }));

  let previousEnd = 0;
  for (const segment of plan.voiceoverSegments) {
    assert.equal(segment.startSeconds, previousEnd);
    assert.ok(segment.endSeconds > segment.startSeconds);
    previousEnd = segment.endSeconds;
  }
  assert.equal(previousEnd, 75);
});

test("createVideoPlan uses stable defaults when optional brief fields are missing", () => {
  const plan = createVideoPlan({
    topic: "Why short-form videos feel addictive",
    audience: "curious creators",
    platforms: ["youtube", "shorts"],
    language: "en",
    tone: "sharp, premium, useful",
    cta: "Subscribe for sharper video strategy",
    styleReferences: [],
    constraints: []
  });

  assert.equal(plan.targetDurationSeconds, 75);
  assert.deepEqual(plan.generationDefaults, {
    model: "kling3_0",
    resolution: "720p"
  });
  assert.equal(plan.continuityAnchors[0].id, "creator-studio-attention-loop");
  assert.ok(plan.continuityAnchors[0].description.includes("dark creator studio"));
});

test("createVideoPlan uses the brief topic for arbitrary explainer plans", () => {
  const plan = createVideoPlan({
    topic: "AI agents for clinic appointment workflows",
    audience: "clinic operators",
    platforms: ["youtube"],
    language: "en",
    tone: "practical and calm",
    cta: "Audit one repeated appointment workflow",
    styleReferences: [],
    constraints: []
  });

  assert.equal(plan.videoType, "explainer");
  assert.ok(plan.voiceoverSegments.some((segment) => {
    return segment.text.includes("AI agents for clinic appointment workflows");
  }));
  assert.ok(plan.plannedShots.some((shot) => {
    return shot.visual.includes("AI agents for clinic appointment workflows");
  }));
  assert.ok(plan.voiceoverSegments.every((segment) => {
    return !segment.text.includes("Short-form does not feel addictive");
  }));
});

test("createVideoPlan builds a guide plan with practical service business examples", () => {
  const plan = createVideoPlan({
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
    assets: [],
    planning: { mode: "template" },
    generationDefaults: { model: "kling3_0", resolution: "720p" },
    styleReferences: [],
    constraints: []
  });

  assert.equal(plan.videoType, "guide");
  assert.equal(plan.language, "en");
  assert.equal(plan.targetDurationSeconds, 120);
  assert.equal(plan.continuityMode, "brand");
  assert.deepEqual(plan.brandStyle, ["modern service business context", "practical examples over hype"]);
  assert.ok(plan.voiceoverSegments.length >= 10);
  assert.ok(plan.voiceoverSegments.some((segment) => segment.text.includes("retail")));
  assert.ok(plan.voiceoverSegments.some((segment) => segment.text.includes("clinics")));
  assert.ok(plan.voiceoverSegments.some((segment) => segment.text.includes("logistics")));
  assert.ok(plan.plannedShots.every((shot) => shot.endSeconds - shot.startSeconds <= 30));
});

test("createVideoPlan splits long generic videos into sub-30-second planned shots", () => {
  const plan = createVideoPlan({
    topic: "Custom product launch",
    audience: "operators",
    platforms: ["youtube"],
    language: "en",
    tone: "practical",
    cta: "Book a workflow audit",
    targetDurationSeconds: 180,
    videoType: "promo_ad",
    productOrOffer: "AI operations service",
    styleReferences: [],
    constraints: []
  });

  assert.ok(plan.plannedShots.length > 5);
  assert.equal(plan.voiceoverSegments.at(-1)?.endSeconds, 180);
  assert.ok(plan.plannedShots.every((shot) => {
    return shot.endSeconds - shot.startSeconds <= 30;
  }));
});

test("videoPlanToScriptMarkdown renders a readable director script", () => {
  const plan = createVideoPlan(sampleBrief);
  const markdown = videoPlanToScriptMarkdown(plan);

  assert.match(markdown, /Why short-form videos feel addictive, explained in 75 seconds/);
  assert.match(markdown, /## Chapter 1: Why the loop works/);
  assert.match(markdown, /### Scene 1: Hook/);
  assert.match(markdown, /### Scene 5: CTA/);
  assert.match(markdown, /Short-form does not feel addictive by accident/);
  assert.match(markdown, /Use Reelwright to turn briefs into consistent video systems/);
});

test("createVideoPlan scripts enough narration for natural local TTS pacing", () => {
  const plan = createVideoPlan(sampleBrief);
  const words = plan.voiceoverSegments
    .flatMap((segment) => segment.text.trim().split(/\s+/))
    .filter(Boolean);

  assert.ok(words.length >= 185);
});
