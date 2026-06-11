import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BriefSchema,
  ShotManifestSchema
} from "../src/domain/schemas.js";
import { createVideoPlan } from "../src/planning/director.js";
import { compileShotManifest } from "../src/planning/manifest.js";

const sampleBrief = BriefSchema.parse(JSON.parse(readFileSync(
  new URL("../briefs/short-form-addiction-director.json", import.meta.url),
  "utf8"
)));

test("compileShotManifest turns a director plan into generation-ready planned shots", () => {
  const plan = createVideoPlan(sampleBrief);
  const manifest = compileShotManifest(plan);
  const finalVoiceover = plan.voiceoverSegments.at(-1);
  assert.ok(finalVoiceover);

  assert.equal(manifest.project, plan.project);
  assert.equal(manifest.totalDurationSeconds, finalVoiceover.endSeconds);
  assert.equal(manifest.shots.length, plan.plannedShots.length);

  for (const [index, shot] of manifest.shots.entries()) {
    const plannedShot = plan.plannedShots[index];
    const beat = plan.beats.find((candidate) => candidate.id === plannedShot.beatId);
    const voiceover = plan.voiceoverSegments.find((segment) => {
      return segment.id === beat?.voiceoverSegmentId;
    });
    assert.ok(voiceover);

    assert.equal(shot.model, "kling3_0");
    assert.equal(shot.aspectRatio, "16:9");
    assert.deepEqual(shot.generation, { resolution: "720p" });
    assert.equal(shot.chapterId, plannedShot.chapterId);
    assert.equal(shot.sceneId, plannedShot.sceneId);
    assert.equal(shot.beatId, plannedShot.beatId);
    assert.equal(shot.shotRole, plannedShot.shotRole);
    assert.equal(shot.continuityId, plannedShot.continuityId);
    assert.equal(shot.voiceoverStartSeconds, plannedShot.startSeconds);
    assert.equal(shot.voiceoverEndSeconds, plannedShot.endSeconds);
    assert.equal(shot.durationSeconds, plannedShot.endSeconds - plannedShot.startSeconds);
    assert.ok(shot.durationSeconds <= 30);
    assert.equal(shot.narration, voiceover.text);
    assert.equal(shot.captionText, voiceover.text);
    assert.equal(shot.status, "planned");
    assert.deepEqual(shot.rejectedTakes, []);
    assert.deepEqual(shot.sourceMedia, []);

    assert.match(shot.prompt, /Same coherent world/);
    assert.match(shot.prompt, new RegExp(plan.continuityAnchors[0].id));
    assert.match(shot.prompt, /one dark creator studio/);
    assert.match(shot.prompt, /Palette: .*electric cyan/);
    assert.match(shot.prompt, new RegExp(escapeRegExp(plannedShot.camera)));
    assert.match(shot.prompt, new RegExp(`Shot role: ${plannedShot.shotRole}`));
    assert.match(shot.prompt, new RegExp(escapeRegExp(plannedShot.visual)));
    assert.match(shot.prompt, /No text/);
    assert.match(shot.prompt, /no logos/);
    assert.match(shot.prompt, /no celebrity likeness/);
    assert.match(shot.prompt, /no real public figures/);
  }

  assert.doesNotThrow(() => ShotManifestSchema.parse(manifest));
});

test("compileShotManifest uses plan settings instead of hardcoded generation defaults", () => {
  const plan = createVideoPlan({
    topic: "Custom product launch",
    audience: "operators",
    platforms: ["youtube"],
    language: "en",
    tone: "practical",
    cta: "Book a workflow audit",
    targetDurationSeconds: 60,
    videoType: "promo_ad",
    productOrOffer: "AI operations service",
    brandStyle: ["matte black hardware", "emerald workflow accents"],
    continuityMode: "brand",
    platformPackage: "standard_social",
    assets: [{
      id: "service-reference",
      kind: "reference",
      description: "AI operations dashboard and service delivery visuals"
    }],
    planning: { mode: "template" },
    generationDefaults: {
      model: "seedance_2_0",
      resolution: "1080p"
    },
    styleReferences: [],
    constraints: ["no readable UI text"]
  });
  const manifest = compileShotManifest(plan);

  assert.ok(manifest.shots.every((shot) => shot.model === "seedance_2_0"));
  assert.ok(manifest.shots.every((shot) => shot.generation?.resolution === "1080p"));
  assert.match(manifest.shots[0]?.prompt ?? "", /Premium conversion-focused promo video/);
  assert.match(manifest.shots[0]?.prompt ?? "", /Continuity mode: brand/);
  assert.match(manifest.shots[0]?.prompt ?? "", /matte black hardware/);
  assert.match(manifest.shots[0]?.prompt ?? "", /service-reference/);
  assert.match(manifest.shots[0]?.prompt ?? "", /AI operations dashboard/);
  assert.match(manifest.shots[0]?.prompt ?? "", /no readable UI text/);
});

test("compileShotManifest uses the shot continuity anchor and preserves source media refs", () => {
  const plan = createVideoPlan({
    topic: "Reference-driven product demo",
    audience: "operators",
    platforms: ["youtube"],
    language: "en",
    tone: "practical",
    cta: "Book a workflow audit",
    videoType: "product_demo",
    assets: [{
      id: "product-photo",
      kind: "product",
      path: "refs/product.png",
      description: "Product reference image"
    }],
    styleReferences: [],
    constraints: []
  });
  plan.continuityAnchors.push({
    id: "secondary-anchor",
    description: "secondary showroom continuity",
    rules: ["silver showroom", "soft product reflections"]
  });
  plan.plannedShots[0].continuityId = "secondary-anchor";
  plan.plannedShots[0].startImage = "refs/start.png";

  const manifest = compileShotManifest(plan);
  const firstShot = manifest.shots[0];

  assert.match(firstShot.prompt, /secondary-anchor/);
  assert.match(firstShot.prompt, /silver showroom/);
  assert.doesNotMatch(firstShot.prompt, new RegExp(plan.continuityAnchors[0].id));
  assert.deepEqual(firstShot.sourceMedia, ["refs/start.png", "refs/product.png"]);
  assert.equal(firstShot.generation?.startImage, "refs/start.png");
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
