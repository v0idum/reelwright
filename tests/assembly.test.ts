import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNormalizeArgs,
  buildRenderArgs,
  buildRenderWithVoiceoverArgs,
  concatFile
} from "../src/ffmpeg/assembly.js";

test("concatFile writes ffmpeg concat list lines with escaped paths", () => {
  assert.equal(
    concatFile([
      "projects/demo/work/normalized/shot-001.mp4",
      "projects/demo/work/normalized/bob's shot\\final.mp4"
    ]),
    "file 'projects/demo/work/normalized/shot-001.mp4'\nfile 'projects/demo/work/normalized/bob'\\''s shot\\final.mp4'\n"
  );
});

test("buildNormalizeArgs creates compatible intermediate clips", () => {
  const args = buildNormalizeArgs({
    inputPath: "projects/demo/media/generated/shot-001.mp4",
    outputPath: "projects/demo/work/normalized/shot-001.mp4",
    durationSeconds: 8
  });

  assert.deepEqual(args.slice(0, 3), ["-y", "-i", "projects/demo/media/generated/shot-001.mp4"]);
  assert.ok(args.includes("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30"));
  assert.ok(!args.includes("-an"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("48000"));
  assert.equal(args.at(-1), "projects/demo/work/normalized/shot-001.mp4");
});

test("buildRenderArgs creates 16:9 export settings", () => {
  const args = buildRenderArgs({
    concatListPath: "projects/demo/work/concat.txt",
    srtPath: "projects/demo/exports/captions.srt",
    outputPath: "projects/demo/exports/demo-youtube-16x9.mp4",
    width: 1920,
    height: 1080
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-f", "concat", "-safe"]);
  assert.ok(!args.includes("anullsrc=channel_layout=stereo:sample_rate=48000"));
  assert.equal(args.at(-1), "projects/demo/exports/demo-youtube-16x9.mp4");
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,subtitles=filename=projects/demo/exports/captions.srt"));
});

test("buildRenderArgs escapes subtitle filename for ffmpeg filtergraphs", () => {
  const args = buildRenderArgs({
    concatListPath: "projects/demo/work/concat.txt",
    srtPath: "projects/demo/exports/lesson: Bob's \\clip, final captions.srt",
    outputPath: "projects/demo/exports/demo-youtube-16x9.mp4",
    width: 1920,
    height: 1080
  });

  assert.ok(
    args.includes(
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,subtitles=filename=projects/demo/exports/lesson\\:\\ Bob\\'s\\ \\\\clip\\,\\ final\\ captions.srt"
    )
  );
});

test("buildRenderArgs can omit burned-in subtitles when ffmpeg lacks the filter", () => {
  const args = buildRenderArgs({
    concatListPath: "projects/demo/work/concat.txt",
    srtPath: "projects/demo/exports/captions.srt",
    outputPath: "projects/demo/exports/demo-youtube-16x9.mp4",
    width: 1920,
    height: 1080,
    burnSubtitles: false
  });

  assert.ok(args.includes("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"));
  assert.ok(!args.some((arg) => arg.includes("subtitles=")));
});

test("buildRenderWithVoiceoverArgs mixes lowered clip audio with voiceover", () => {
  const args = buildRenderWithVoiceoverArgs({
    concatListPath: "projects/demo/work/concat.txt",
    srtPath: "projects/demo/exports/captions.srt",
    voiceoverPath: "projects/demo/media/voiceover/voiceover.aiff",
    outputPath: "projects/demo/exports/demo-youtube-16x9.mp4",
    width: 1920,
    height: 1080
  });

  assert.deepEqual(args.slice(0, 7), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "projects/demo/work/concat.txt"
  ]);
  assert.ok(args.includes("projects/demo/media/voiceover/voiceover.aiff"));

  const filterIndex = args.indexOf("-filter_complex");
  assert.notEqual(filterIndex, -1);
  const filterGraph = args[filterIndex + 1];
  assert.match(filterGraph, /\[0:v\].*scale=1920:1080:force_original_aspect_ratio=increase.*crop=1920:1080.*subtitles=filename=projects\/demo\/exports\/captions\.srt\[vout\]/);
  assert.match(filterGraph, /\[0:a\]volume=0\.18\[bed\]/);
  assert.match(filterGraph, /\[1:a\]volume=1\.0\[vo\]/);
  assert.match(filterGraph, /\[bed\]\[vo\]amix=inputs=2:duration=longest:dropout_transition=0\[aout\]/);

  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4), [
    "-map",
    "[vout]",
    "-map",
    "[aout]"
  ]);
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("48000"));
  assert.ok(args.includes("2"));
  assert.equal(args.at(-1), "projects/demo/exports/demo-youtube-16x9.mp4");
});
