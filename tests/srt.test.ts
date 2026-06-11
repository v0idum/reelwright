import test from "node:test";
import assert from "node:assert/strict";
import { shotsToSrt, timestamp } from "../src/domain/srt.js";

test("timestamp formats SRT time", () => {
  assert.equal(timestamp(65.25), "00:01:05,250");
});

test("timestamp rejects invalid seconds", () => {
  assert.throws(() => timestamp(-1), /seconds must be a non-negative finite number/);
  assert.throws(() => timestamp(Number.POSITIVE_INFINITY), /seconds must be a non-negative finite number/);
});

test("shotsToSrt creates monotonic caption blocks", () => {
  const srt = shotsToSrt([
    { id: "a", durationSeconds: 2, captionText: "First" },
    { id: "b", durationSeconds: 3.5, captionText: "Second" }
  ]);

  assert.equal(
    srt,
    "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:02,000 --> 00:00:05,500\nSecond\n"
  );
});

test("shotsToSrt rejects invalid shot durations before creating captions", () => {
  assert.throws(() => {
    shotsToSrt([
      { id: "a", durationSeconds: 2, captionText: "First" },
      { id: "b", durationSeconds: -1, captionText: "Second" }
    ]);
  }, /shot b durationSeconds must be a positive finite number/);
});
