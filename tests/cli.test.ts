import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HELP_TEXT,
  parseArgs,
  runDoctorCommand,
  runPlanCommand
} from "../src/cli.js";

test("parseArgs parses mvp command", () => {
  assert.deepEqual(parseArgs(["mvp", "briefs/short-form-addiction.json"]), {
    command: "mvp",
    briefPath: "briefs/short-form-addiction.json"
  });
});

test("parseArgs parses director-mvp command", () => {
  assert.deepEqual(parseArgs(["director-mvp", "briefs/short-form-addiction-director.json"]), {
    command: "director-mvp",
    briefPath: "briefs/short-form-addiction-director.json"
  });
});

test("parseArgs parses run command", () => {
  assert.deepEqual(parseArgs(["run", "briefs/ai-video-workflow-demo.json"]), {
    command: "run",
    briefPath: "briefs/ai-video-workflow-demo.json"
  });
});

test("parseArgs parses plan command", () => {
  assert.deepEqual(parseArgs(["plan", "briefs/ai-video-workflow-demo.json"]), {
    command: "plan",
    briefPath: "briefs/ai-video-workflow-demo.json"
  });
});

test("parseArgs parses doctor command without a brief", () => {
  assert.deepEqual(parseArgs(["doctor"]), { command: "doctor" });
});

test("parseArgs rejects missing brief", () => {
  assert.throws(() => parseArgs(["plan"]), /brief path/);
  assert.throws(() => parseArgs(["mvp"]), /brief path/);
  assert.throws(() => parseArgs(["director-mvp"]), /brief path/);
  assert.throws(() => parseArgs(["run"]), /brief path/);
});

test("parseArgs returns help for missing or help commands", () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    assert.deepEqual(parseArgs(args), { command: "help" });
  }
});

test("parseArgs rejects unknown commands", () => {
  assert.throws(() => parseArgs(["render"]), /unknown command/);
});

test("help text lists commands, credit warning, and safe plan example", () => {
  assert.match(HELP_TEXT, /Commands:/);
  assert.match(HELP_TEXT, /doctor\s+checks local tools/);
  assert.match(HELP_TEXT, /plan <brief\.json>\s+SAFE/);
  assert.match(HELP_TEXT, /may spend Higgsfield or local compute credits/);
  assert.match(HELP_TEXT, /npm run demo:plan/);
});

test("runDoctorCommand reports available and missing tools", async () => {
  const result = await runDoctorCommand({
    nodeVersion: "20.11.0",
    runTool: async (command) => {
      return {
        ok: command !== "higgsfield",
        detail: command === "higgsfield" ? "not found" : "available"
      };
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.checks, [
    { name: "node", ok: true, detail: "20.11.0" },
    { name: "ffmpeg", ok: true, detail: "available" },
    { name: "ffprobe", ok: true, detail: "available" },
    { name: "higgsfield", ok: false, detail: "not found" }
  ]);
  assert.match(result.output, /OK\s+node\s+20\.11\.0/);
  assert.match(result.output, /MISSING\s+higgsfield\s+not found/);
});

test("runPlanCommand writes only planning artifacts for template briefs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "reelwright-plan-cli-"));
  try {
    const brief = {
      topic: "CLI Plan Command Test",
      audience: "operators",
      platforms: ["youtube"],
      language: "en",
      tone: "practical",
      cta: "Review the plan",
      planning: { mode: "template" },
      styleReferences: [],
      constraints: []
    };
    const briefPath = join(rootDir, "brief.json");
    await writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");

    const result = await runPlanCommand(rootDir, briefPath);
    const projectDir = join(rootDir, "projects", "cli-plan-command-test");

    assert.deepEqual(result, {
      slug: "cli-plan-command-test",
      planPath: join(projectDir, "video-plan.json"),
      scriptPath: join(projectDir, "script.md"),
      manifestPath: join(projectDir, "shot-manifest.json")
    });
    assert.equal((await stat(join(projectDir, "video-plan.json"))).isFile(), true);
    assert.equal((await stat(join(projectDir, "script.md"))).isFile(), true);
    assert.equal((await stat(join(projectDir, "shot-manifest.json"))).isFile(), true);
    await assert.rejects(() => stat(join(projectDir, "media")), /ENOENT/);
    await assert.rejects(() => stat(join(projectDir, "exports")), /ENOENT/);

    const plan = JSON.parse(await readFile(join(projectDir, "video-plan.json"), "utf8")) as {
      project: string;
    };
    const manifest = JSON.parse(await readFile(join(projectDir, "shot-manifest.json"), "utf8")) as {
      project: string;
      shots: unknown[];
    };

    assert.equal(plan.project, "cli-plan-command-test");
    assert.match(await readFile(join(projectDir, "script.md"), "utf8"), /# CLI Plan Command Test/);
    assert.equal(manifest.project, "cli-plan-command-test");
    assert.ok(manifest.shots.length > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
