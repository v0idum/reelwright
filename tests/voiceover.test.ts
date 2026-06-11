import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalTtsVoiceoverArgs,
  buildLocalPlaceholderVoiceoverArgs,
  buildRetimedVoiceoverArgs,
  isSafeTempoAdjustment,
  localTtsVoiceoverAudioPath,
  rawVoiceoverAudioPath,
  resolveVoiceoverAudioPath,
  voiceoverAudioPath,
  voiceoverText,
  voiceoverTextPath
} from "../src/audio/voiceover.js";
import type { VideoPlan } from "../src/planning/director.js";

const plan = {
  voiceoverSegments: [
    { id: "vo-002", text: "Second line.", startSeconds: 3, endSeconds: 6 },
    { id: "vo-001", text: "First line.", startSeconds: 0, endSeconds: 3 },
    { id: "vo-003", text: "Third line.", startSeconds: 6, endSeconds: 9 }
  ]
} as VideoPlan;

test("voiceoverText joins voiceover segment text in timeline order", () => {
  assert.equal(voiceoverText(plan), "First line.\n\nSecond line.\n\nThird line.");
});

test("buildLocalPlaceholderVoiceoverArgs reads a text file and writes audio", () => {
  const command = buildLocalPlaceholderVoiceoverArgs({
    textPath: "projects/demo/media/voiceover/voiceover.txt",
    outputPath: "projects/demo/media/voiceover/voiceover.aiff"
  });

  assert.ok(command.command === "/usr/bin/say" || command.command === "say");
  assert.deepEqual(command.args, [
    "-v",
    "Samantha",
    "-f",
    "projects/demo/media/voiceover/voiceover.txt",
    "-o",
    "projects/demo/media/voiceover/voiceover.aiff"
  ]);
});

test("buildLocalTtsVoiceoverArgs invokes project-local Kokoro through MLX-Audio", () => {
  const command = buildLocalTtsVoiceoverArgs({
    text: "This is a local narration test.",
    outputDirectory: "projects/demo/media/voiceover",
    filePrefix: "voiceover"
  });

  assert.equal(command.command, ".venv/bin/mlx_audio.tts.generate");
  assert.deepEqual(command.args, [
    "--model",
    "mlx-community/Kokoro-82M-4bit",
    "--text",
    "This is a local narration test.",
    "--voice",
    "af_heart",
    "--speed",
    "1.05",
    "--lang_code",
    "a",
    "--output_path",
    "projects/demo/media/voiceover",
    "--file_prefix",
    "voiceover",
    "--join_audio",
    "--audio_format",
    "wav"
  ]);
});

test("buildRetimedVoiceoverArgs stretches placeholder narration to target duration", () => {
  const args = buildRetimedVoiceoverArgs({
    inputPath: "projects/demo/media/voiceover/voiceover.raw.aiff",
    outputPath: "projects/demo/media/voiceover/voiceover.aiff",
    inputDurationSeconds: 44.668435,
    targetDurationSeconds: 75
  });

  assert.deepEqual(args.slice(0, 3), ["-y", "-i", "projects/demo/media/voiceover/voiceover.raw.aiff"]);
  assert.equal(args[args.indexOf("-af") + 1], "atempo=0.595579,apad,atrim=duration=75");
  assert.ok(args.includes("pcm_s16le"));
  assert.ok(args.includes("48000"));
  assert.ok(args.includes("2"));
  assert.equal(args.at(-1), "projects/demo/media/voiceover/voiceover.aiff");
});

test("isSafeTempoAdjustment allows only small narration tempo corrections", () => {
  assert.equal(isSafeTempoAdjustment(1), true);
  assert.equal(isSafeTempoAdjustment(0.94), true);
  assert.equal(isSafeTempoAdjustment(1.06), true);
  assert.equal(isSafeTempoAdjustment(0.595579), false);
  assert.equal(isSafeTempoAdjustment(1.25), false);
});

test("resolveVoiceoverAudioPath returns provided audio path", () => {
  assert.equal(
    resolveVoiceoverAudioPath({
      rootDir: "/repo",
      projectDir: "/repo/projects/demo",
      voiceover: { mode: "provided_audio", audioPath: "/tmp/narration.wav" }
    }),
    "/tmp/narration.wav"
  );
});

test("resolveVoiceoverAudioPath returns local TTS wav path under project media", () => {
  assert.equal(
    resolveVoiceoverAudioPath({
      rootDir: "/repo",
      projectDir: "/repo/projects/demo",
      voiceover: {
        mode: "local_tts",
        engine: "mlx_audio",
        model: "mlx-community/Kokoro-82M-4bit",
        voice: "af_heart",
        speed: 1.05,
        langCode: "a",
        audioFormat: "wav"
      }
    }),
    "/repo/projects/demo/media/voiceover/voiceover.wav"
  );
});

test("resolveVoiceoverAudioPath returns generated placeholder path under project media", () => {
  assert.equal(
    resolveVoiceoverAudioPath({
      rootDir: "/repo",
      projectDir: "/repo/projects/demo",
      voiceover: { mode: "local_placeholder" }
    }),
    "/repo/projects/demo/media/voiceover/voiceover.aiff"
  );
});

test("voiceover helper paths are under project media voiceover", () => {
  assert.equal(
    voiceoverTextPath("/repo/projects/demo"),
    "/repo/projects/demo/media/voiceover/voiceover.txt"
  );
  assert.equal(
    voiceoverAudioPath("/repo/projects/demo"),
    "/repo/projects/demo/media/voiceover/voiceover.aiff"
  );
  assert.equal(
    rawVoiceoverAudioPath("/repo/projects/demo"),
    "/repo/projects/demo/media/voiceover/voiceover.raw.aiff"
  );
  assert.equal(
    localTtsVoiceoverAudioPath("/repo/projects/demo"),
    "/repo/projects/demo/media/voiceover/voiceover.wav"
  );
});
