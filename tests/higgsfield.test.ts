import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerateArgs,
  findFirstMediaUrl,
  parseHiggsfieldJsonPayload
} from "../src/higgsfield/runner.js";

test("buildGenerateArgs uses Seedance 2.0 with wait and json", () => {
  const args = buildGenerateArgs({
    model: "seedance_2_0",
    prompt: "cinematic shot of abstract attention tunnel",
    durationSeconds: 8,
    aspectRatio: "16:9"
  });

  assert.deepEqual(args, [
    "generate", "create", "seedance_2_0",
    "--prompt", "cinematic shot of abstract attention tunnel",
    "--duration", "8",
    "--aspect_ratio", "16:9",
    "--resolution", "720p",
    "--wait",
    "--json"
  ]);
});

test("buildGenerateArgs uses Kling 3.0 std mode with reference images", () => {
  const args = buildGenerateArgs({
    model: "kling3_0",
    prompt: "cinematic shot of abstract attention tunnel",
    durationSeconds: 8,
    aspectRatio: "16:9",
    resolution: "720p",
    startImage: "projects/demo/media/references/shot-001.png",
    endImage: "projects/demo/media/references/shot-001-end.png"
  });

  assert.deepEqual(args, [
    "generate", "create", "kling3_0",
    "--prompt", "cinematic shot of abstract attention tunnel",
    "--duration", "8",
    "--aspect_ratio", "16:9",
    "--mode", "std",
    "--start-image", "projects/demo/media/references/shot-001.png",
    "--end-image", "projects/demo/media/references/shot-001-end.png",
    "--wait",
    "--json"
  ]);
});

test("buildGenerateArgs rounds fractional durations up for model requests", () => {
  const args = buildGenerateArgs({
    model: "kling3_0",
    prompt: "cinematic shot of a connected operations dashboard",
    durationSeconds: 23.389,
    aspectRatio: "16:9",
    resolution: "720p"
  });

  assert.equal(args[args.indexOf("--duration") + 1], "24");
});

test("buildGenerateArgs maps Kling 3.0 4k requests to mode 4k", () => {
  const args = buildGenerateArgs({
    model: "kling3_0",
    prompt: "cinematic shot of abstract attention tunnel",
    durationSeconds: 8,
    aspectRatio: "16:9",
    resolution: "4k"
  });

  assert.ok(args.includes("--mode"));
  assert.equal(args[args.indexOf("--mode") + 1], "4k");
  assert.ok(!args.includes("--resolution"));
});

test("findFirstMediaUrl finds nested mp4 urls", () => {
  const url = findFirstMediaUrl([{ result: { url: "https://cdn.example.com/render.mp4" } }]);
  assert.equal(url, "https://cdn.example.com/render.mp4");
});

test("findFirstMediaUrl prefers signed media fields over unrelated urls", () => {
  const url = findFirstMediaUrl({
    log: {
      url: "https://status.example.com/jobs/job-123"
    },
    result: {
      videoUrl: "https://cdn.example.com/signed/render?X-Amz-Signature=abc123"
    }
  });

  assert.equal(url, "https://cdn.example.com/signed/render?X-Amz-Signature=abc123");
});

test("findFirstMediaUrl accepts query-string format hints from media fields", () => {
  const url = findFirstMediaUrl({
    response: {
      assets: [
        {
          asset_url: "https://cdn.example.com/render?id=asset-42&format=webm&token=secret"
        }
      ]
    }
  });

  assert.equal(url, "https://cdn.example.com/render?id=asset-42&format=webm&token=secret");
});

test("findFirstMediaUrl accepts extensionless signed urls from generic url media fields", () => {
  const url = findFirstMediaUrl({
    url: "https://cdn.example.com/render/signed-output?X-Amz-Signature=abc123"
  });

  assert.equal(url, "https://cdn.example.com/render/signed-output?X-Amz-Signature=abc123");
});

test("parseHiggsfieldJsonPayload parses pure json", () => {
  assert.deepEqual(
    parseHiggsfieldJsonPayload("{\"result\":{\"url\":\"https://cdn.example.com/render.mp4\"}}"),
    { result: { url: "https://cdn.example.com/render.mp4" } }
  );
});

test("parseHiggsfieldJsonPayload parses final json after progress lines", () => {
  assert.deepEqual(
    parseHiggsfieldJsonPayload(
      "queued job-123\nrendering 50%\n{\"result\":{\"url\":\"https://cdn.example.com/render.mp4\"}}\n"
    ),
    { result: { url: "https://cdn.example.com/render.mp4" } }
  );
});

test("parseHiggsfieldJsonPayload parses final pretty json object", () => {
  assert.deepEqual(
    parseHiggsfieldJsonPayload(
      "queued job-123\n{\n  \"result\": {\n    \"downloadUrl\": \"https://cdn.example.com/signed/render?token=abc\"\n  }\n}\n"
    ),
    { result: { downloadUrl: "https://cdn.example.com/signed/render?token=abc" } }
  );
});
