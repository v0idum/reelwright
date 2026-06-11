import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMediaDuration, parseProbe } from "../src/ffmpeg/probe.js";
import { validateProbe, writeQaReport } from "../src/qa/report.js";

test("validateProbe reports matching resolution without errors", () => {
  const report = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 39.2,
      hasAudio: true,
      bitrate: 4_000_000
    }
  });

  assert.equal(report.issues.filter((issue) => issue.severity === "error").length, 0);
});

test("validateProbe flags wrong resolution", () => {
  const report = validateProbe("out.mp4", {
    expectedWidth: 1080,
    expectedHeight: 1920,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 39,
      hasAudio: true,
      bitrate: 4_000_000
    }
  });

  assert.match(report.issues[0].message, /resolution/);
});

test("parseProbe throws on no video stream", () => {
  assert.throws(
    () => parseProbe({ streams: [{ codec_type: "audio" }], format: { duration: "39", bit_rate: "4000000" } }),
    /video stream/
  );
});

test("parseProbe throws on invalid width or height", () => {
  assert.throws(
    () => parseProbe({ streams: [{ codec_type: "video", width: "bad", height: "1080" }] }),
    /width/
  );
  assert.throws(
    () => parseProbe({ streams: [{ codec_type: "video", width: "1920", height: "0" }] }),
    /height/
  );
});

test("parseProbe prefers format duration over stream duration", () => {
  const probe = parseProbe({
    streams: [{ codec_type: "video", width: "1920", height: "1080", duration: "12.5", bit_rate: "2000000" }],
    format: { duration: "39.2", bit_rate: "4000000" }
  });

  assert.equal(probe.durationSeconds, 39.2);
  assert.equal(probe.bitrate, 4_000_000);
});

test("parseMediaDuration reads positive format or stream duration", () => {
  assert.equal(parseMediaDuration({ format: { duration: "75.034667" } }), 75.034667);
  assert.equal(parseMediaDuration({ streams: [{ codec_type: "audio", duration: "44.668435" }] }), 44.668435);
  assert.throws(() => parseMediaDuration({ streams: [{}], format: {} }), /positive media duration/);
});

test("validateProbe warns on no audio", () => {
  const report = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 39,
      hasAudio: false,
      bitrate: 4_000_000
    }
  });

  assert.ok(report.issues.some((issue) => issue.severity === "warning" && /audio/i.test(issue.message)));
});

test("validateProbe warns on invalid or zero bitrate", () => {
  const invalidBitrateReport = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 39,
      hasAudio: true,
      bitrate: Number.NaN
    }
  });
  const zeroBitrateReport = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 39,
      hasAudio: true,
      bitrate: 0
    }
  });

  assert.ok(invalidBitrateReport.issues.some((issue) => /bitrate/i.test(issue.message)));
  assert.ok(zeroBitrateReport.issues.some((issue) => /bitrate/i.test(issue.message)));
});

test("validateProbe warns on duration mismatch and invalid duration", () => {
  const mismatchReport = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: 44,
      hasAudio: true,
      bitrate: 4_000_000
    }
  });
  const invalidDurationReport = validateProbe("out.mp4", {
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedDurationSeconds: 39,
    probe: {
      width: 1920,
      height: 1080,
      durationSeconds: Number.NaN,
      hasAudio: true,
      bitrate: 4_000_000
    }
  });

  assert.ok(mismatchReport.issues.some((issue) => /duration/i.test(issue.message)));
  assert.ok(invalidDurationReport.issues.some((issue) => /duration/i.test(issue.message)));
  assert.equal(invalidDurationReport.durationSeconds, undefined);
});

test("writeQaReport writes JSON and markdown sibling with expected content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reelwright-qa-"));
  try {
    const jsonPath = join(directory, "reports", "out.json");
    const report = validateProbe("out.mp4", {
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedDurationSeconds: 39,
      probe: {
        width: 1920,
        height: 1080,
        durationSeconds: 39,
        hasAudio: true,
        bitrate: 4_000_000
      }
    });

    await writeQaReport(jsonPath, report);

    const json = JSON.parse(await readFile(jsonPath, "utf8"));
    const markdown = await readFile(join(directory, "reports", "out.md"), "utf8");

    assert.equal(json.exportPath, "out.mp4");
    assert.match(markdown, /Export: out\.mp4/);
    assert.match(markdown, /Resolution: 1920x1080/);
    assert.match(markdown, /Duration: 39\.00 seconds/);
    assert.match(markdown, /No issues found/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
