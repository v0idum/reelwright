import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brief, ShotManifest } from "../src/domain/schemas.js";
import { createVideoPlan } from "../src/planning/director.js";
import type { VideoPlan } from "../src/planning/director.js";
import { compileShotManifest } from "../src/planning/manifest.js";
import {
  creativeQaMarkdown,
  validateCreativeQa,
  writeCreativeQaReport
} from "../src/qa/creative.js";

const brief: Brief = {
  topic: "Creative QA Test",
  audience: "editors",
  platforms: ["youtube"],
  language: "en",
  tone: "direct",
  cta: "Ship it",
  targetDurationSeconds: 75,
  generationDefaults: {
    model: "kling3_0",
    resolution: "720p"
  },
  voiceover: { mode: "local_placeholder" },
  visualContinuity: ["one coherent test studio"],
  styleReferences: [],
  constraints: []
};

function validFixture(): { plan: VideoPlan; manifest: ShotManifest } {
  const plan = createVideoPlan(brief);
  return {
    plan,
    manifest: compileShotManifest(plan)
  };
}

function messagesFor(input: {
  plan: VideoPlan;
  manifest: ShotManifest;
  voiceoverPath?: string;
  voiceover?: {
    provider: "provided_audio" | "local_tts" | "local_placeholder";
    durationSeconds?: number;
    targetDurationSeconds?: number;
    tempoAdjustmentRatio?: number;
    timelineAdjusted?: boolean;
  };
}): string[] {
  return validateCreativeQa(input).issues.map((issue) => issue.message);
}

test("validateCreativeQa returns no issues for a consistent director plan and manifest", () => {
  const { plan, manifest } = validFixture();

  const report = validateCreativeQa({
    plan,
    manifest,
    voiceoverPath: "/tmp/voiceover.aiff"
  });

  assert.equal(report.project, "creative-qa-test");
  assert.equal(report.voiceoverPath, "/tmp/voiceover.aiff");
  assert.deepEqual(report.issues, []);
});

test("validateCreativeQa warns when voiceoverPath is missing or empty", () => {
  const missing = validFixture();
  const empty = validFixture();

  assert.ok(
    messagesFor({ ...missing }).some((message) => message.includes("voiceoverPath is missing"))
  );
  assert.ok(
    messagesFor({ ...empty, voiceoverPath: "  " }).some((message) => message.includes("voiceoverPath is missing"))
  );
});

test("validateCreativeQa warns when a shot has no continuityId", () => {
  const { plan, manifest } = validFixture();
  delete manifest.shots[0]?.continuityId;

  assert.ok(
    messagesFor({ plan, manifest, voiceoverPath: "/tmp/voiceover.aiff" }).some((message) => {
      return message.includes("shot-001") && message.includes("continuityId");
    })
  );
});

test("validateCreativeQa warns when a shot model differs from the plan generation default", () => {
  const { plan, manifest } = validFixture();
  manifest.shots[0]!.model = "veo3";

  assert.ok(
    messagesFor({ plan, manifest, voiceoverPath: "/tmp/voiceover.aiff" }).some((message) => {
      return message.includes("shot-001") && message.includes("model veo3") && message.includes("kling3_0");
    })
  );
});

test("validateCreativeQa warns when a shot generation resolution differs from the plan default", () => {
  const { plan, manifest } = validFixture();
  manifest.shots[0]!.generation = { resolution: "1080p" };

  assert.ok(
    messagesFor({ plan, manifest, voiceoverPath: "/tmp/voiceover.aiff" }).some((message) => {
      return message.includes("shot-001") && message.includes("resolution 1080p") && message.includes("720p");
    })
  );
});

test("validateCreativeQa reports non-monotonic voiceover segment timing", () => {
  const { plan, manifest } = validFixture();
  plan.voiceoverSegments[1]!.startSeconds = plan.voiceoverSegments[0]!.endSeconds - 1;

  const report = validateCreativeQa({ plan, manifest, voiceoverPath: "/tmp/voiceover.aiff" });

  assert.ok(
    report.issues.some((issue) => {
      return issue.severity === "error" && issue.message.includes("not monotonic");
    })
  );
});

test("validateCreativeQa warns when shot hierarchy ids and voiceover timing are missing", () => {
  const { plan, manifest } = validFixture();
  delete manifest.shots[0]?.chapterId;
  delete manifest.shots[0]?.sceneId;
  delete manifest.shots[0]?.beatId;
  delete manifest.shots[0]?.voiceoverStartSeconds;
  delete manifest.shots[0]?.voiceoverEndSeconds;

  const messages = messagesFor({ plan, manifest, voiceoverPath: "/tmp/voiceover.aiff" });

  assert.ok(messages.some((message) => message.includes("shot-001") && message.includes("chapterId")));
  assert.ok(messages.some((message) => message.includes("shot-001") && message.includes("sceneId")));
  assert.ok(messages.some((message) => message.includes("shot-001") && message.includes("beatId")));
  assert.ok(messages.some((message) => message.includes("shot-001") && message.includes("voiceoverStartSeconds")));
  assert.ok(messages.some((message) => message.includes("shot-001") && message.includes("voiceoverEndSeconds")));
});

test("validateCreativeQa warns on placeholder voice and excessive tempo adjustment", () => {
  const { plan, manifest } = validFixture();
  const messages = messagesFor({
    plan,
    manifest,
    voiceoverPath: "/tmp/voiceover.aiff",
    voiceover: {
      provider: "local_placeholder",
      durationSeconds: 75,
      targetDurationSeconds: 75,
      tempoAdjustmentRatio: 0.595579
    }
  });

  assert.ok(messages.some((message) => message.includes("local_placeholder") && message.includes("fallback")));
  assert.ok(messages.some((message) => message.includes("tempo adjustment") && message.includes("0.595579")));
});

test("creative QA markdown and writer serialize the report", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-creative-qa-"));
  try {
    const { plan, manifest } = validFixture();
    const report = validateCreativeQa({ plan, manifest, voiceoverPath: "" });
    const jsonPath = join(rootDir, "reports", "creative-qa.json");

    assert.match(creativeQaMarkdown(report), /# Creative QA Report/);

    await writeCreativeQaReport(jsonPath, report);

    assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).project, "creative-qa-test");
    assert.match(await readFile(join(rootDir, "reports", "creative-qa.md"), "utf8"), /voiceoverPath is missing/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
