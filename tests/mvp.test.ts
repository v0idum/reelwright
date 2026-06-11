import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runMvp } from "../src/pipeline/mvp.js";
import type { MvpPipelineDependencies } from "../src/pipeline/mvp.js";
import type { Brief, ShotManifest } from "../src/domain/schemas.js";

const brief: Brief = {
  topic: "Resumable Pipeline Test",
  audience: "editors",
  platforms: ["youtube"],
  language: "en",
  tone: "direct",
  cta: "Ship it",
  styleReferences: [],
  constraints: []
};

function testDependencies(overrides: Partial<MvpPipelineDependencies> = {}): MvpPipelineDependencies {
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
    runFfmpeg: async () => {},
    ffmpegSupportsFilter: async () => true,
    probeVideo: async () => ({
      width: 1920,
      height: 1080,
      durationSeconds: 8,
      hasAudio: true,
      bitrate: 4_000_000
    }),
    ...overrides
  };
}

async function writeBrief(rootDir: string): Promise<string> {
  const briefPath = join(rootDir, "brief.json");
  await writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  return briefPath;
}

function manifestWithShot(shot: ShotManifest["shots"][number]): ShotManifest {
  return {
    project: "resumable-pipeline-test",
    totalDurationSeconds: shot.durationSeconds,
    shots: [shot]
  };
}

async function readManifest(rootDir: string): Promise<ShotManifest> {
  return JSON.parse(
    await readFile(join(rootDir, "projects", "resumable-pipeline-test", "shot-manifest.json"), "utf8")
  ) as ShotManifest;
}

test("runMvp keeps an existing manifest and skips paid work for deterministic generated clips", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "resumable-pipeline-test");
    const clipPath = join(projectDir, "media", "generated", "shot-001.mp4");
    const manifestClipPath = join("projects", "resumable-pipeline-test", "media", "generated", "shot-001.mp4");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const manifest = manifestWithShot({
      id: "shot-001",
      scene: "Existing",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A valid existing generated clip for a resumed project",
      sourceMedia: [],
      narration: "Existing narration",
      captionText: "Existing caption",
      musicCue: "",
      sfx: [],
      status: "generated",
      outputUrl: "https://cdn.example.com/existing.mp4",
      localPath: manifestClipPath,
      rejectedTakes: ["keep-this-review-note"]
    });

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(clipPath, "video-bytes");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await runMvp(rootDir, briefPath, testDependencies());

    assert.deepEqual(await readManifest(rootDir), manifest);
    assert.equal((await stat(clipPath)).size, "video-bytes".length);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runMvp rejects mismatched non-empty localPath and resumes from outputUrl", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "resumable-pipeline-test");
    const staleClipPath = join(projectDir, "media", "generated", "stale-shot.mp4");
    const deterministicClipPath = join(projectDir, "media", "generated", "shot-001.mp4");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const manifest = manifestWithShot({
      id: "shot-001",
      scene: "Stale",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A stale local path should not be accepted for this shot",
      sourceMedia: [],
      narration: "Stale narration",
      captionText: "Stale caption",
      musicCue: "",
      sfx: [],
      status: "generated",
      outputUrl: "https://cdn.example.com/stale-resume.mp4",
      localPath: staleClipPath,
      rejectedTakes: []
    });
    const downloads: string[] = [];

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(staleClipPath, "stale-video-bytes");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await runMvp(
      rootDir,
      briefPath,
      testDependencies({
        downloadFile: async (url, destination) => {
          downloads.push(url);
          assert.equal(destination, deterministicClipPath);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "downloaded-video");
        }
      })
    );

    const updated = await readManifest(rootDir);
    assert.deepEqual(downloads, ["https://cdn.example.com/stale-resume.mp4"]);
    assert.equal(updated.shots[0]?.localPath, join("projects", "resumable-pipeline-test", "media", "generated", "shot-001.mp4"));
    assert.equal((await stat(staleClipPath)).size, "stale-video-bytes".length);
    assert.equal((await stat(deterministicClipPath)).size, "downloaded-video".length);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runMvp regenerates when mismatched non-empty localPath has no outputUrl", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "resumable-pipeline-test");
    const staleClipPath = join(projectDir, "media", "generated", "old-shot.mp4");
    const deterministicClipPath = join(projectDir, "media", "generated", "shot-001.mp4");
    const manifestClipPath = join("projects", "resumable-pipeline-test", "media", "generated", "shot-001.mp4");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const manifest = manifestWithShot({
      id: "shot-001",
      scene: "Regenerate",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A stale local path without output URL should regenerate this shot",
      sourceMedia: [],
      narration: "Regenerate narration",
      captionText: "Regenerate caption",
      musicCue: "",
      sfx: [],
      status: "generated",
      localPath: staleClipPath,
      rejectedTakes: []
    });
    let generationCalls = 0;
    const downloads: Array<{ url: string; destination: string }> = [];

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(staleClipPath, "stale-video-bytes");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await runMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async () => {
          generationCalls += 1;
          return {
            outputUrl: "https://cdn.example.com/regenerated.mp4",
            metadata: {
              jobId: "job-regenerated"
            }
          };
        },
        downloadFile: async (url, destination) => {
          downloads.push({ url, destination });
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "regenerated-video");
        }
      })
    );

    const updated = await readManifest(rootDir);
    assert.equal(generationCalls, 1);
    assert.deepEqual(downloads, [
      {
        url: "https://cdn.example.com/regenerated.mp4",
        destination: deterministicClipPath
      }
    ]);
    assert.equal(updated.shots[0]?.localPath, manifestClipPath);
    assert.equal(updated.shots[0]?.outputUrl, "https://cdn.example.com/regenerated.mp4");
    assert.equal((await stat(staleClipPath)).size, "stale-video-bytes".length);
    assert.equal((await stat(deterministicClipPath)).size, "regenerated-video".length);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runMvp downloads from existing outputUrl instead of creating another job", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "resumable-pipeline-test");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const manifest = manifestWithShot({
      id: "shot-001",
      scene: "Paid",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A paid generation that already returned an output URL",
      sourceMedia: [],
      narration: "Paid narration",
      captionText: "Paid caption",
      musicCue: "",
      sfx: [],
      status: "generated",
      outputUrl: "https://cdn.example.com/paid.mp4",
      rejectedTakes: []
    });
    const downloads: string[] = [];

    await mkdir(projectDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await runMvp(
      rootDir,
      briefPath,
      testDependencies({
        downloadFile: async (url, destination) => {
          downloads.push(url);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "downloaded-video");
        }
      })
    );

    const updated = await readManifest(rootDir);
    assert.deepEqual(downloads, ["https://cdn.example.com/paid.mp4"]);
    assert.equal(updated.shots[0]?.outputUrl, "https://cdn.example.com/paid.mp4");
    assert.equal(updated.shots[0]?.status, "generated");
    assert.match(updated.shots[0]?.localPath ?? "", /projects\/resumable-pipeline-test\/media\/generated\/shot-001\.mp4$/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runMvp persists paid generation metadata before downloading", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    let sawPersistedStateBeforeDownload = false;

    await runMvp(
      rootDir,
      briefPath,
      testDependencies({
        runHiggsfieldGenerate: async () => ({
          outputUrl: "https://cdn.example.com/new-paid.mp4",
          metadata: {
            jobId: "job-123",
            result: {
              outputUrl: "https://cdn.example.com/new-paid.mp4"
            }
          }
        }),
        downloadFile: async (_url, destination) => {
          const manifest = await readManifest(rootDir);
          const sidecar = JSON.parse(
            await readFile(
              join(rootDir, "projects", "resumable-pipeline-test", "media", "generated", "shot-001.json"),
              "utf8"
            )
          ) as { jobId?: string };

          if (destination.endsWith("shot-001.mp4")) {
            sawPersistedStateBeforeDownload =
              manifest.shots[0]?.outputUrl === "https://cdn.example.com/new-paid.mp4" &&
              manifest.shots[0]?.status === "generated" &&
              manifest.shots[0]?.higgsfieldJobId === "job-123" &&
              manifest.shots[0]?.localPath === undefined &&
              sidecar.jobId === "job-123";
          }

          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "downloaded-video");
        }
      })
    );

    assert.equal(sawPersistedStateBeforeDownload, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runMvp renders without burned subtitles when ffmpeg lacks subtitles filter", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-mvp-"));
  try {
    const briefPath = await writeBrief(rootDir);
    const projectDir = join(rootDir, "projects", "resumable-pipeline-test");
    const clipPath = join(projectDir, "media", "generated", "shot-001.mp4");
    const manifestClipPath = join("projects", "resumable-pipeline-test", "media", "generated", "shot-001.mp4");
    const manifestPath = join(projectDir, "shot-manifest.json");
    const renderArgs: string[][] = [];
    const manifest = manifestWithShot({
      id: "shot-001",
      scene: "Existing",
      durationSeconds: 8,
      aspectRatio: "16:9",
      model: "seedance_2_0",
      prompt: "A valid existing generated clip for a resumed project",
      sourceMedia: [],
      narration: "Existing narration",
      captionText: "Existing caption",
      musicCue: "",
      sfx: [],
      status: "generated",
      outputUrl: "https://cdn.example.com/existing.mp4",
      localPath: manifestClipPath,
      rejectedTakes: []
    });

    await mkdir(join(projectDir, "media", "generated"), { recursive: true });
    await writeFile(clipPath, "video-bytes");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await runMvp(
      rootDir,
      briefPath,
      testDependencies({
        ffmpegSupportsFilter: async (filterName) => filterName !== "subtitles",
        runFfmpeg: async (args) => {
          renderArgs.push(args);
        }
      })
    );

    const finalRenderArgs = renderArgs.filter((args) => args.at(-1)?.includes(`${projectDir}/exports/`));
    assert.equal(finalRenderArgs.length, 2);
    assert.ok(finalRenderArgs.every((args) => !args.some((arg) => arg.includes("subtitles="))));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
