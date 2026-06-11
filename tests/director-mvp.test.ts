import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runDirectorMvp } from "../src/pipeline/director-mvp.js";
import type { DirectorMvpPipelineDependencies } from "../src/pipeline/director-mvp.js";
import type { Brief, ShotManifest } from "../src/domain/schemas.js";
import { createVideoPlan } from "../src/planning/director.js";
import { compileShotManifest } from "../src/planning/manifest.js";

const brief: Brief = {
  topic: "Director Pipeline Test",
  audience: "editors",
  platforms: ["youtube", "shorts"],
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

const localTtsBrief: Brief = {
  ...brief,
  voiceover: {
    mode: "local_tts",
    engine: "mlx_audio",
    model: "mlx-community/Kokoro-82M-4bit",
    voice: "af_heart",
    speed: 1.05,
    langCode: "a",
    audioFormat: "wav"
  }
};

function testDependencies(
  overrides: Partial<DirectorMvpPipelineDependencies> = {}
): DirectorMvpPipelineDependencies {
  return {
    runHiggsfieldGenerate: async () => {
      throw new Error("generation should not be called");
    },
    downloadFile: async () => {
      throw new Error("download should not be called");
    },
    writeMetadata: async (path, metadata) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    },
    runFfmpeg: async (args) => {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, "ffmpeg-output");
    },
    ffmpegSupportsFilter: async () => true,
    probeVideo: async (path) => ({
      width: path.includes("shorts-9x16") ? 1080 : 1920,
      height: path.includes("shorts-9x16") ? 1920 : 1080,
      durationSeconds: 75,
      hasAudio: true,
      bitrate: 4_000_000
    }),
    probeMediaDuration: async () => 75,
    runVoiceoverCommand: async () => {
      throw new Error("voiceover command should not be called");
    },
    ...overrides
  };
}

async function writeBrief(rootDir: string, value: Brief = brief): Promise<string> {
  const briefPath = join(rootDir, "brief.json");
  await writeFile(briefPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return briefPath;
}

async function readManifest(rootDir: string): Promise<ShotManifest> {
  return JSON.parse(
    await readFile(join(rootDir, "projects", "director-pipeline-test", "shot-manifest.json"), "utf8")
  ) as ShotManifest;
}

test("runDirectorMvp creates director artifacts and renders with injected dependencies", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const generatedShotIds: string[] = [];
    const downloads: Array<{ url: string; destination: string }> = [];
    const ffmpegArgs: string[][] = [];
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];
    const probedExports: string[] = [];
    const probedDurations: string[] = [];

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          generatedShotIds.push(shot.id);
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          downloads.push({ url, destination });
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          assert.equal(command, "/usr/bin/say");
          const outputPath = args[args.indexOf("-o") + 1];
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "raw-voiceover-audio");
        },
        runFfmpeg: async (args) => {
          ffmpegArgs.push(args);
          const outputPath = args.at(-1);
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "ffmpeg-output");
        },
        probeVideo: async (path) => {
          probedExports.push(path);
          return {
            width: path.includes("shorts-9x16") ? 1080 : 1920,
            height: path.includes("shorts-9x16") ? 1920 : 1080,
            durationSeconds: 75,
            hasAudio: true,
            bitrate: 4_000_000
          };
        },
        probeMediaDuration: async (path) => {
          probedDurations.push(path);
          return path.endsWith("voiceover.raw.aiff") ? 44.668435 : 75;
        }
      })
    );

    assert.equal((await stat(projectDir)).isDirectory(), true);
    assert.equal((await stat(join(projectDir, "media", "generated"))).isDirectory(), true);
    assert.equal((await stat(join(projectDir, "media", "voiceover"))).isDirectory(), true);
    assert.equal((await stat(join(projectDir, "exports"))).isDirectory(), true);
    assert.equal((await stat(join(projectDir, "reports"))).isDirectory(), true);
    assert.equal((await stat(join(projectDir, "work", "normalized"))).isDirectory(), true);

    const plan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as { project: string };
    assert.equal(plan.project, "director-pipeline-test");
    assert.match(await readFile(join(projectDir, "script.md"), "utf8"), /# Director Pipeline Test/);

    const manifest = await readManifest(rootDir);
    assert.equal(manifest.shots.length, 7);
    assert.deepEqual(generatedShotIds, manifest.shots.map((shot) => shot.id));
    assert.deepEqual(downloads.map((download) => download.url), generatedShotIds.map((id) => `https://cdn.example.com/${id}.mp4`));
    assert.equal(manifest.shots[0]?.outputUrl, "https://cdn.example.com/shot-001.mp4");
    assert.equal(manifest.shots[0]?.localPath, join("projects", "director-pipeline-test", "media", "generated", "shot-001.mp4"));

    const voiceoverText = await readFile(join(projectDir, "media", "voiceover", "voiceover.txt"), "utf8");
    assert.match(voiceoverText, /Director Pipeline Test is easier to understand/);
    assert.deepEqual(voiceoverCommands, [
      {
        command: "/usr/bin/say",
        args: [
          "-v",
          "Samantha",
          "-f",
          join(projectDir, "media", "voiceover", "voiceover.txt"),
          "-o",
          join(projectDir, "media", "voiceover", "voiceover.raw.aiff")
        ]
      }
    ]);

    assert.deepEqual(probedDurations, [
      join(projectDir, "media", "voiceover", "voiceover.raw.aiff")
    ]);
    assert.ok(ffmpegArgs.some((args) => {
      return args.includes("atempo=0.595579,apad,atrim=duration=75")
        && args.at(-1) === join(projectDir, "media", "voiceover", "voiceover.aiff");
    }));

    const renderArgs = ffmpegArgs.filter((args) => args.includes("-filter_complex"));
    assert.equal(renderArgs.length, 2);
    assert.ok(renderArgs.every((args) => args.includes(join(projectDir, "media", "voiceover", "voiceover.aiff"))));
    assert.ok(renderArgs.some((args) => args.at(-1) === join(projectDir, "exports", "director-pipeline-test-youtube-16x9.mp4")));
    assert.ok(renderArgs.some((args) => args.at(-1) === join(projectDir, "exports", "director-pipeline-test-shorts-9x16.mp4")));

    assert.match(await readFile(join(projectDir, "exports", "director-pipeline-test.srt"), "utf8"), /1\n00:00:00,000/);
    assert.equal(probedExports.length, 2);
    assert.equal(
      JSON.parse(await readFile(join(projectDir, "reports", "youtube-16x9-qa.json"), "utf8")).actualWidth,
      1920
    );
    assert.equal(
      JSON.parse(await readFile(join(projectDir, "reports", "shorts-9x16-qa.json"), "utf8")).actualHeight,
      1920
    );
    const creativeQa = JSON.parse(await readFile(join(projectDir, "reports", "creative-qa.json"), "utf8")) as {
      issues: Array<{ message: string }>;
    };
    assert.ok(creativeQa.issues.some((issue) => issue.message.includes("local_placeholder")));
    assert.match(
      await readFile(join(projectDir, "reports", "creative-qa.md"), "utf8"),
      /# Creative QA Report/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp passes configured local placeholder voice to say", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir, {
      ...brief,
      voiceover: { mode: "local_placeholder", voice: "Milena" }
    });
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          const outputPath = args[args.indexOf("-o") + 1];
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "raw-voiceover-audio");
        },
        probeMediaDuration: async (path) => path.endsWith("voiceover.raw.aiff") ? 44.668435 : 75
      })
    );

    assert.equal(voiceoverCommands[0]?.command, "/usr/bin/say");
    assert.equal(voiceoverCommands[0]?.args[voiceoverCommands[0].args.indexOf("-v") + 1], "Milena");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp can use an injected universal planner", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const universalBrief: Brief = {
      ...brief,
      topic: "Injected Planner Test",
      videoType: "guide",
      targetDurationSeconds: 60,
      brandStyle: ["business operations guide"],
      continuityMode: "brand",
      platformPackage: "standard_social",
      assets: [],
      planning: { mode: "template" }
    };
    const briefPath = await writeBrief(rootDir, universalBrief);
    const projectDir = join(rootDir, "projects", "injected-planner-test");
    const injectedPlan = createVideoPlan(universalBrief);
    let plannerCalls = 0;

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        createVideoPlan: async (receivedBrief) => {
          plannerCalls += 1;
          assert.equal(receivedBrief.topic, universalBrief.topic);
          return injectedPlan;
        },
        runHiggsfieldGenerate: async (shot) => {
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (_command, args) => {
          const outputPath = args[args.indexOf("-o") + 1];
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "raw-voiceover-audio");
        },
        probeMediaDuration: async (path) => path.endsWith("voiceover.raw.aiff") ? 35 : 60,
        probeVideo: async (path) => ({
          width: path.includes("shorts-9x16") ? 1080 : 1920,
          height: path.includes("shorts-9x16") ? 1920 : 1080,
          durationSeconds: 60,
          hasAudio: true,
          bitrate: 4_000_000
        })
      })
    );

    assert.equal(plannerCalls, 1);
    const writtenPlan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      videoType: string;
      continuityMode: string;
    };
    assert.equal(writtenPlan.videoType, "guide");
    assert.equal(writtenPlan.continuityMode, "brand");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp refreshes a cached plan when brief planning settings change", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const updatedBrief: Brief = {
      ...brief,
      topic: "Cached Universal Plan Test",
      videoType: "guide",
      targetDurationSeconds: 60,
      brandStyle: ["updated brand system"],
      continuityMode: "brand",
      platformPackage: "standard_social",
      assets: [],
      planning: { mode: "template" }
    };
    const staleBrief: Brief = {
      ...updatedBrief,
      videoType: "explainer",
      brandStyle: [],
      continuityMode: "style"
    };
    const briefPath = await writeBrief(rootDir, updatedBrief);
    const projectDir = join(rootDir, "projects", "cached-universal-plan-test");
    const stalePlan = createVideoPlan(staleBrief);
    const staleManifest = compileShotManifest(stalePlan);
    const refreshedPlan = createVideoPlan(updatedBrief);
    let plannerCalls = 0;

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(join(projectDir, "video-plan.json"), `${JSON.stringify(stalePlan, null, 2)}\n`, "utf8");
    for (const shot of staleManifest.shots) {
      shot.status = "generated";
      shot.outputUrl = `https://cdn.example.com/existing-${shot.id}.mp4`;
      shot.localPath = join("projects", "cached-universal-plan-test", "media", "generated", `${shot.id}.mp4`);
      await writeFile(join(rootDir, shot.localPath), `existing-${shot.id}`);
    }
    await writeFile(join(projectDir, "shot-manifest.json"), `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        createVideoPlan: async () => {
          plannerCalls += 1;
          return refreshedPlan;
        },
        runHiggsfieldGenerate: async (shot) => {
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { id: `job-${shot.id}` }
          };
        },
        downloadFile: async (_url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "downloaded");
        },
        runVoiceoverCommand: async (_command, args) => {
          const outputPath = args[args.indexOf("-o") + 1];
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "raw-voiceover-audio");
        },
        probeMediaDuration: async (path) => path.endsWith("voiceover.raw.aiff") ? 35 : 60,
        probeVideo: async (path) => ({
          width: path.includes("shorts-9x16") ? 1080 : 1920,
          height: path.includes("shorts-9x16") ? 1920 : 1080,
          durationSeconds: 60,
          hasAudio: true,
          bitrate: 4_000_000
        })
      })
    );

    const writtenPlan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      videoType: string;
      continuityMode: string;
      brandStyle: string[];
    };
    assert.equal(plannerCalls, 1);
    assert.equal(writtenPlan.videoType, "guide");
    assert.equal(writtenPlan.continuityMode, "brand");
    assert.deepEqual(writtenPlan.brandStyle, ["updated brand system"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp refreshes a cached plan when generated content is stale", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const updatedBrief: Brief = {
      ...brief,
      topic: "Cached Content Plan Test",
      videoType: "explainer",
      targetDurationSeconds: 75,
      planning: { mode: "template" }
    };
    const briefPath = await writeBrief(rootDir, updatedBrief);
    const projectDir = join(rootDir, "projects", "cached-content-plan-test");
    const refreshedPlan = createVideoPlan(updatedBrief);
    const stalePlan = structuredClone(refreshedPlan);
    stalePlan.voiceoverSegments[0].text = "Stale cached narration from an older planner.";
    stalePlan.plannedShots[0].visual = "Stale cached visual from an older planner.";
    const staleManifest = compileShotManifest(stalePlan);
    let plannerCalls = 0;

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(join(projectDir, "video-plan.json"), `${JSON.stringify(stalePlan, null, 2)}\n`, "utf8");
    await writeFile(join(projectDir, "shot-manifest.json"), `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        createVideoPlan: async () => {
          plannerCalls += 1;
          return refreshedPlan;
        },
        runHiggsfieldGenerate: async (shot) => ({
          outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
          metadata: { id: `job-${shot.id}` }
        }),
        downloadFile: async (_url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "downloaded");
        },
        runVoiceoverCommand: async (_command, args) => {
          const outputPath = args[args.indexOf("-o") + 1];
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "raw-voiceover-audio");
        },
        probeMediaDuration: async (path) => path.endsWith("voiceover.raw.aiff") ? 35 : 75
      })
    );

    const writtenPlan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      voiceoverSegments: Array<{ text: string }>;
      plannedShots: Array<{ visual: string }>;
    };
    assert.equal(plannerCalls, 1);
    assert.doesNotMatch(writtenPlan.voiceoverSegments[0]?.text ?? "", /Stale cached narration/);
    assert.doesNotMatch(writtenPlan.plannedShots[0]?.visual ?? "", /Stale cached visual/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp refreshes an invalid cached plan before generation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const updatedBrief: Brief = {
      ...brief,
      topic: "Invalid Cached Plan Test",
      planning: { mode: "template" }
    };
    const briefPath = await writeBrief(rootDir, updatedBrief);
    const projectDir = join(rootDir, "projects", "invalid-cached-plan-test");
    const refreshedPlan = createVideoPlan(updatedBrief);
    const existingManifest = compileShotManifest(refreshedPlan);
    const voiceoverText = [...refreshedPlan.voiceoverSegments]
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .map((segment) => segment.text)
      .join("\n\n");
    let plannerCalls = 0;
    let generationCalls = 0;
    let downloadCalls = 0;
    let voiceoverCommands = 0;
    let ffmpegCalls = 0;

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await mkdir(join(projectDir, "media", "voiceover"), { recursive: true });
    await writeFile(
      join(projectDir, "video-plan.json"),
      `${JSON.stringify({
        project: refreshedPlan.project,
        topic: refreshedPlan.topic,
        targetDurationSeconds: refreshedPlan.targetDurationSeconds
      }, null, 2)}\n`,
      "utf8"
    );
    for (const shot of existingManifest.shots) {
      shot.status = "generated";
      shot.outputUrl = `https://cdn.example.com/existing-${shot.id}.mp4`;
      shot.localPath = join("projects", "invalid-cached-plan-test", "media", "generated", `${shot.id}.mp4`);
      await writeFile(join(rootDir, shot.localPath), `existing-${shot.id}`);
    }
    await writeFile(join(projectDir, "shot-manifest.json"), `${JSON.stringify(existingManifest, null, 2)}\n`, "utf8");
    await writeFile(join(projectDir, "media", "voiceover", "voiceover.txt"), voiceoverText, "utf8");
    await writeFile(join(projectDir, "media", "voiceover", "voiceover.aiff"), "existing-voiceover");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        createVideoPlan: async (receivedBrief) => {
          plannerCalls += 1;
          assert.equal(receivedBrief.topic, updatedBrief.topic);
          return refreshedPlan;
        },
        runHiggsfieldGenerate: async () => {
          generationCalls += 1;
          throw new Error("invalid cached plan should refresh before generation");
        },
        downloadFile: async () => {
          downloadCalls += 1;
          throw new Error("existing generated clips should be reused");
        },
        runVoiceoverCommand: async () => {
          voiceoverCommands += 1;
          throw new Error("existing matching voiceover should be reused");
        },
        runFfmpeg: async (args) => {
          ffmpegCalls += 1;
          const outputPath = args.at(-1);
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "ffmpeg-output");
        },
        probeMediaDuration: async () => refreshedPlan.targetDurationSeconds
      })
    );

    const writtenPlan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      videoType: string;
      generationDefaults: { model: string };
      plannedShots: Array<{ id: string }>;
    };
    const updatedManifest = JSON.parse(await readFile(join(projectDir, "shot-manifest.json"), "utf8")) as ShotManifest;
    assert.equal(plannerCalls, 1);
    assert.equal(generationCalls, 0);
    assert.equal(downloadCalls, 0);
    assert.equal(voiceoverCommands, 0);
    assert.ok(ffmpegCalls > 0);
    assert.equal(writtenPlan.videoType, refreshedPlan.videoType);
    assert.equal(writtenPlan.generationDefaults.model, refreshedPlan.generationDefaults.model);
    assert.deepEqual(writtenPlan.plannedShots.map((shot) => shot.id), refreshedPlan.plannedShots.map((shot) => shot.id));
    assert.equal(updatedManifest.shots[0]?.localPath, existingManifest.shots[0]?.localPath);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp reuses resolved shots and generates only unresolved shots", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const planPath = join(projectDir, "video-plan.json");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const voiceoverAudioPath = join(projectDir, "media", "voiceover", "voiceover.aiff");
    const generatedShotIds: string[] = [];
    const downloads: string[] = [];
    const plan = createVideoPlan(brief);
    const manifest = compileShotManifest(plan);

    for (const shot of manifest.shots) {
      if (shot.id === "shot-002") {
        continue;
      }

      shot.status = "generated";
      shot.outputUrl = `https://cdn.example.com/existing-${shot.id}.mp4`;
      shot.localPath = join("projects", "director-pipeline-test", "media", "generated", `${shot.id}.mp4`);
      const clipPath = join(rootDir, shot.localPath);
      await mkdir(dirname(clipPath), { recursive: true });
      await writeFile(clipPath, `existing-${shot.id}`);
    }

    await mkdir(dirname(planPath), { recursive: true });
    await mkdir(dirname(voiceoverAudioPath), { recursive: true });
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(voiceoverAudioPath, "existing-voiceover");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          generatedShotIds.push(shot.id);
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { id: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          downloads.push(url);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async () => {
          throw new Error("existing non-empty voiceover should be reused");
        },
        probeMediaDuration: async () => 75
      })
    );

    const updated = await readManifest(rootDir);
    assert.deepEqual(generatedShotIds, ["shot-002"]);
    assert.deepEqual(downloads, ["https://cdn.example.com/shot-002.mp4"]);
    assert.equal(updated.shots[1]?.localPath, join("projects", "director-pipeline-test", "media", "generated", "shot-002.mp4"));
    assert.equal((await stat(join(projectDir, "media", "generated", "shot-001.mp4"))).size, "existing-shot-001".length);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp uses local TTS duration as the edit timeline", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir, localTtsBrief);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const voiceoverAudioPath = join(projectDir, "media", "voiceover", "voiceover.wav");
    const ffmpegArgs: string[][] = [];
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];
    const measuredVoiceoverDuration = 61.5;

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          const outputDirectory = args[args.indexOf("--output_path") + 1];
          const filePrefix = args[args.indexOf("--file_prefix") + 1];
          assert.ok(outputDirectory);
          assert.ok(filePrefix);
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(join(outputDirectory, `${filePrefix}.wav`), "local-tts-audio");
        },
        probeMediaDuration: async (path) => path === voiceoverAudioPath ? measuredVoiceoverDuration : 75,
        runFfmpeg: async (args) => {
          ffmpegArgs.push(args);
          const outputPath = args.at(-1);
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "ffmpeg-output");
        },
        probeVideo: async (path) => ({
          width: path.includes("shorts-9x16") ? 1080 : 1920,
          height: path.includes("shorts-9x16") ? 1920 : 1080,
          durationSeconds: measuredVoiceoverDuration,
          hasAudio: true,
          bitrate: 4_000_000
        })
      })
    );

    assert.deepEqual(voiceoverCommands, [
      {
        command: ".venv/bin/mlx_audio.tts.generate",
        args: [
          "--model",
          "mlx-community/Kokoro-82M-4bit",
          "--text",
          await readFile(join(projectDir, "media", "voiceover", "voiceover.txt"), "utf8"),
          "--voice",
          "af_heart",
          "--speed",
          "1.05",
          "--lang_code",
          "a",
          "--output_path",
          join(projectDir, "media", "voiceover"),
          "--file_prefix",
          "voiceover",
          "--join_audio",
          "--audio_format",
          "wav"
        ]
      }
    ]);

    const plan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      targetDurationSeconds: number;
      voiceoverSegments: Array<{ endSeconds: number }>;
    };
    const manifest = await readManifest(rootDir);
    assert.equal(plan.targetDurationSeconds, measuredVoiceoverDuration);
    assert.equal(plan.voiceoverSegments.at(-1)?.endSeconds, measuredVoiceoverDuration);
    assert.equal(manifest.totalDurationSeconds, measuredVoiceoverDuration);
    assert.equal(manifest.shots.at(-1)?.voiceoverEndSeconds, measuredVoiceoverDuration);
    assert.ok(manifest.shots.every((shot) => shot.durationSeconds > 0 && shot.durationSeconds <= 30));

    const normalizeArgs = ffmpegArgs.filter((args) => args.includes("-t"));
    const normalizedDurationTotal = normalizeArgs.reduce((sum, args) => {
      return sum + Number(args[args.indexOf("-t") + 1]);
    }, 0);
    assert.equal(Number(normalizedDurationTotal.toFixed(3)), measuredVoiceoverDuration);
    assert.ok(ffmpegArgs.every((args) => !args.some((arg) => arg.includes("atempo=0.595579"))));
    assert.ok(ffmpegArgs.some((args) => args.includes(voiceoverAudioPath)));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp splits local TTS timelines to the selected model generation cap", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir, localTtsBrief);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const voiceoverAudioPath = join(projectDir, "media", "voiceover", "voiceover.wav");
    const generatedDurations: number[] = [];
    const measuredVoiceoverDuration = 240;

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          generatedDurations.push(shot.durationSeconds);
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (_command, args) => {
          const outputDirectory = args[args.indexOf("--output_path") + 1];
          const filePrefix = args[args.indexOf("--file_prefix") + 1];
          assert.ok(outputDirectory);
          assert.ok(filePrefix);
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(join(outputDirectory, `${filePrefix}.wav`), "local-tts-audio");
        },
        probeMediaDuration: async (path) => path === voiceoverAudioPath ? measuredVoiceoverDuration : 75,
        probeVideo: async (path) => ({
          width: path.includes("shorts-9x16") ? 1080 : 1920,
          height: path.includes("shorts-9x16") ? 1920 : 1080,
          durationSeconds: measuredVoiceoverDuration,
          hasAudio: true,
          bitrate: 4_000_000
        })
      })
    );

    const plan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      plannedShots: Array<{ startSeconds: number; endSeconds: number }>;
      voiceoverSegments: Array<{ endSeconds: number }>;
    };
    const manifest = await readManifest(rootDir);

    assert.equal(plan.voiceoverSegments.at(-1)?.endSeconds, measuredVoiceoverDuration);
    assert.equal(manifest.totalDurationSeconds, measuredVoiceoverDuration);
    assert.ok(plan.plannedShots.length > 7);
    assert.ok(plan.plannedShots.every((shot) => shot.endSeconds - shot.startSeconds <= 15));
    assert.ok(manifest.shots.every((shot) => shot.durationSeconds <= 15));
    assert.ok(generatedDurations.every((duration) => duration <= 15));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp regenerates local TTS when script text changes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir, localTtsBrief);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const voiceoverDir = join(projectDir, "media", "voiceover");
    const voiceoverAudioPath = join(voiceoverDir, "voiceover.wav");
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];

    await mkdir(voiceoverDir, { recursive: true });
    await writeFile(join(voiceoverDir, "voiceover.txt"), "Old narration text.");
    await writeFile(voiceoverAudioPath, "stale-local-tts-audio");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async (shot) => {
          return {
            outputUrl: `https://cdn.example.com/${shot.id}.mp4`,
            metadata: { jobId: `job-${shot.id}` }
          };
        },
        downloadFile: async (url, destination) => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, `clip:${url}`);
        },
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          await writeFile(voiceoverAudioPath, "fresh-local-tts-audio");
        },
        probeMediaDuration: async (path) => path === voiceoverAudioPath ? 65 : 75
      })
    );

    assert.equal(voiceoverCommands.length, 1);
    assert.ok(voiceoverCommands[0]?.args.includes("--text"));
    assert.match(
      voiceoverCommands[0]?.args[voiceoverCommands[0].args.indexOf("--text") + 1] ?? "",
      /Director Pipeline Test is easier to understand/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp refreshes undersized local TTS plans and preserves generated clips", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir, localTtsBrief);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const stalePlan = createVideoPlan(localTtsBrief);
    stalePlan.targetDurationSeconds = 48.65;
    stalePlan.voiceoverSegments.forEach((segment, index) => {
      segment.text = `Legacy short segment ${index + 1}.`;
    });
    const staleManifest = compileShotManifest(stalePlan);
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];

    await mkdir(projectDir, { recursive: true });
    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(join(projectDir, "video-plan.json"), `${JSON.stringify(stalePlan, null, 2)}\n`, "utf8");
    for (const shot of staleManifest.shots) {
      shot.status = "generated";
      shot.outputUrl = `https://cdn.example.com/existing-${shot.id}.mp4`;
      shot.localPath = join("projects", "director-pipeline-test", "media", "generated", `${shot.id}.mp4`);
      await writeFile(join(rootDir, shot.localPath), `existing-${shot.id}`);
    }
    await writeFile(join(projectDir, "shot-manifest.json"), `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async () => {
          throw new Error("refreshed plan should preserve existing generated clips");
        },
        downloadFile: async () => {
          throw new Error("refreshed plan should not redownload existing generated clips");
        },
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          const outputDirectory = args[args.indexOf("--output_path") + 1];
          const filePrefix = args[args.indexOf("--file_prefix") + 1];
          assert.ok(outputDirectory);
          assert.ok(filePrefix);
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(join(outputDirectory, `${filePrefix}.wav`), "fresh-local-tts-audio");
        },
        probeMediaDuration: async (path) => path.endsWith("voiceover.wav") ? 65 : 75
      })
    );

    assert.equal(voiceoverCommands.length, 1);
    assert.match(
      voiceoverCommands[0]?.args[voiceoverCommands[0].args.indexOf("--text") + 1] ?? "",
      /Director Pipeline Test is easier to understand/
    );
    const updatedManifest = await readManifest(rootDir);
    assert.equal(updatedManifest.shots[0]?.localPath, staleManifest.shots[0]?.localPath);
    assert.equal(updatedManifest.shots[0]?.outputUrl, staleManifest.shots[0]?.outputUrl);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runDirectorMvp retimes stale placeholder voiceover before rendering", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-director-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "director-pipeline-test");
    const voiceoverAudioPath = join(projectDir, "media", "voiceover", "voiceover.aiff");
    const voiceoverRawPath = join(projectDir, "media", "voiceover", "voiceover.raw.aiff");
    const plan = createVideoPlan(brief);
    const manifest = compileShotManifest(plan);
    const ffmpegArgs: string[][] = [];
    const voiceoverCommands: Array<{ command: string; args: string[] }> = [];
    const durationByPath = new Map<string, number>([
      [voiceoverAudioPath, 44.668435],
      [voiceoverRawPath, 44.668435]
    ]);

    await mkdir(join(projectDir, "media", "voiceover"), { recursive: true });
    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(join(projectDir, "video-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    for (const shot of manifest.shots) {
      shot.status = "generated";
      shot.outputUrl = `https://cdn.example.com/${shot.id}.mp4`;
      shot.localPath = join("projects", "director-pipeline-test", "media", "generated", `${shot.id}.mp4`);
      await writeFile(join(rootDir, shot.localPath), `existing-${shot.id}`);
    }
    await writeFile(join(projectDir, "shot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(voiceoverAudioPath, "too-short-voiceover");

    await runDirectorMvp(
      rootDir,
      briefPath,
      testDependencies({
        runVoiceoverCommand: async (command, args) => {
          voiceoverCommands.push({ command, args });
          await writeFile(voiceoverRawPath, "raw-voiceover");
        },
        probeMediaDuration: async (path) => durationByPath.get(path) ?? 75,
        runFfmpeg: async (args) => {
          ffmpegArgs.push(args);
          const outputPath = args.at(-1);
          assert.ok(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "ffmpeg-output");
        }
      })
    );

    assert.equal(voiceoverCommands.length, 1);
    assert.ok(ffmpegArgs.some((args) => {
      return args.includes("atempo=0.595579,apad,atrim=duration=75")
        && args.at(-1) === voiceoverAudioPath;
    }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
