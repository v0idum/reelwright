import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BriefSchema, ShotManifestSchema } from "../src/domain/schemas.js";
import { createProject, readBrief, slugify } from "../src/domain/project.js";

const sampleBrief = BriefSchema.parse({
  topic: "Why short-form videos feel addictive, explained in 45 seconds",
  audience: "curious creators and small business owners",
  platforms: ["youtube", "shorts"],
  language: "en",
  tone: "fast, sharp, cinematic, useful",
  cta: "Follow for sharper creative strategy",
  styleReferences: [
    "kinetic creator explainer",
    "premium social media documentary",
    "high contrast macro visuals"
  ],
  constraints: [
    "avoid real public figures",
    "avoid copyrighted app logos",
    "no medical claims"
  ]
});

test("slugify creates lowercase hyphenated slugs without punctuation", () => {
  assert.equal(
    slugify("Why short-form videos feel addictive!"),
    "why-short-form-videos-feel-addictive"
  );
});

test("readBrief parses the sample brief", async () => {
  const brief = await readBrief("briefs/short-form-addiction.json");

  assert.equal(
    slugify(brief.topic),
    "why-short-form-videos-feel-addictive-explained-in-45-seconds"
  );
  assert.deepEqual(brief, sampleBrief);
});

test("createProject creates workspace directories and planned shot files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-project-"));

  try {
    const created = await createProject(rootDir, sampleBrief);
    assert.equal(
      created.slug,
      "why-short-form-videos-feel-addictive-explained-in-45-seconds"
    );

    for (const path of [
      join(created.projectDir, "media", "raw"),
      join(created.projectDir, "media", "generated"),
      join(created.projectDir, "exports"),
      join(created.projectDir, "reports")
    ]) {
      assert.equal((await stat(path)).isDirectory(), true);
    }

    const storyBible = JSON.parse(await readFile(created.storyBiblePath, "utf8"));
    assert.match(storyBible.visualStyle, /cinematic macro visuals/i);
    assert.match(storyBible.promptTemplate, /no text/i);
    assert.match(storyBible.promptTemplate, /no logos/i);

    const manifestJson = JSON.parse(await readFile(created.manifestPath, "utf8"));
    const manifest = ShotManifestSchema.parse(manifestJson);
    assert.equal(manifest.project, created.slug);
    assert.equal(manifest.totalDurationSeconds, 39);
    assert.equal(manifest.shots.length, 5);
    assert.equal(manifest.shots[0]?.id, "shot-001");
    assert.deepEqual(
      manifest.shots.map((shot) => shot.status),
      ["planned", "planned", "planned", "planned", "planned"]
    );
    assert.deepEqual(
      manifest.shots.map((shot) => shot.model),
      ["seedance_2_0", "seedance_2_0", "seedance_2_0", "seedance_2_0", "seedance_2_0"]
    );
    assert.deepEqual(
      manifest.shots.map((shot) => shot.aspectRatio),
      ["16:9", "16:9", "16:9", "16:9", "16:9"]
    );
    for (const shot of manifest.shots) {
      assert.match(shot.prompt, /no text/i);
      assert.match(shot.prompt, /no logos/i);
      assert.match(shot.prompt, /high-quality social video/i);
    }
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
