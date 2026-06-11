#!/usr/bin/env -S node --import tsx

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readBrief,
  slugify,
  writeJson
} from "./domain/project.js";
import { runDirectorMvp } from "./pipeline/director-mvp.js";
import { runMvp } from "./pipeline/mvp.js";
import {
  createVideoPlan as createTemplateVideoPlan,
  videoPlanToScriptMarkdown
} from "./planning/director.js";
import type { VideoPlan } from "./planning/director.js";
import { createPlanWithLocalLlm } from "./planning/local-llm.js";
import { compileShotManifest } from "./planning/manifest.js";

export const HELP_TEXT = [
  "Usage: npm run reelwright -- <command> [brief.json]",
  "",
  "Commands:",
  "  doctor                     checks local tools: Node, ffmpeg, ffprobe, and Higgsfield.",
  "  plan <brief.json>          SAFE: writes/refreshes video-plan.json, script.md, and shot-manifest.json only.",
  "  run <brief.json>           may spend Higgsfield or local compute credits; runs the director pipeline.",
  "  director-mvp <brief.json>  may spend Higgsfield or local compute credits; alias for run.",
  "  mvp <brief.json>           may spend Higgsfield credits; runs the legacy MVP pipeline.",
  "",
  "Quickstart:",
  "  npm run doctor",
  "  npm run demo:plan"
].join("\n");

export type ParsedArgs =
  | { command: "doctor" }
  | { command: "plan"; briefPath: string }
  | { command: "mvp"; briefPath: string }
  | { command: "director-mvp"; briefPath: string }
  | { command: "run"; briefPath: string }
  | { command: "help" };

export type PlanCommandResult = {
  slug: string;
  planPath: string;
  scriptPath: string;
  manifestPath: string;
};

export type DoctorCheck = {
  name: "node" | "ffmpeg" | "ffprobe" | "higgsfield";
  ok: boolean;
  detail: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
  output: string;
};

type ToolCheckResult = {
  ok: boolean;
  detail: string;
};

type DoctorOptions = {
  nodeVersion?: string;
  runTool?: (command: "ffmpeg" | "ffprobe" | "higgsfield") => Promise<ToolCheckResult>;
};

export function parseArgs(args: string[]): ParsedArgs {
  const [command, briefPath] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "doctor") {
    return { command };
  }

  if (command === "plan" || command === "mvp" || command === "director-mvp" || command === "run") {
    if (!briefPath) {
      throw new Error(`${command} command requires a brief path`);
    }

    return { command, briefPath };
  }

  throw new Error(`unknown command: ${command}`);
}

function resolveBriefPath(rootDir: string, briefPath: string): string {
  return isAbsolute(briefPath) ? briefPath : join(rootDir, briefPath);
}

function nodeVersionCheck(version: string): DoctorCheck {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return {
    name: "node",
    ok: Number.isInteger(major) && major >= 20,
    detail: version
  };
}

function commandArgs(command: "ffmpeg" | "ffprobe" | "higgsfield"): string[] {
  if (command === "higgsfield") {
    return ["--help"];
  }

  return ["-version"];
}

function firstOutputLine(output: string): string {
  return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "available";
}

async function defaultRunTool(command: "ffmpeg" | "ffprobe" | "higgsfield"): Promise<ToolCheckResult> {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs(command), {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, detail: error.message });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        detail: code === 0 ? firstOutputLine(output) : firstOutputLine(output) || `exit ${code}`
      });
    });
  });
}

function formatDoctorOutput(checks: DoctorCheck[]): string {
  return checks.map((check) => {
    const status = check.ok ? "OK" : "MISSING";
    return `${status.padEnd(7)} ${check.name.padEnd(10)} ${check.detail}`;
  }).join("\n");
}

export async function runDoctorCommand(options: DoctorOptions = {}): Promise<DoctorResult> {
  const runTool = options.runTool ?? defaultRunTool;
  const checks: DoctorCheck[] = [
    nodeVersionCheck(options.nodeVersion ?? process.versions.node)
  ];

  for (const name of ["ffmpeg", "ffprobe", "higgsfield"] as const) {
    const result = await runTool(name);
    checks.push({ name, ok: result.ok, detail: result.detail });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    output: formatDoctorOutput(checks)
  };
}

async function createDefaultVideoPlan(briefPath: string): Promise<VideoPlan> {
  const brief = await readBrief(briefPath);
  if (brief.planning.mode === "local_llm") {
    return createPlanWithLocalLlm(brief);
  }

  return createTemplateVideoPlan(brief);
}

export async function runPlanCommand(rootDir: string, briefPath: string): Promise<PlanCommandResult> {
  const resolvedBriefPath = resolveBriefPath(rootDir, briefPath);
  const plan = await createDefaultVideoPlan(resolvedBriefPath);
  const slug = slugify(plan.topic);
  const projectDir = join(rootDir, "projects", slug);
  const planPath = join(projectDir, "video-plan.json");
  const scriptPath = join(projectDir, "script.md");
  const manifestPath = join(projectDir, "shot-manifest.json");

  await mkdir(projectDir, { recursive: true });
  await writeJson(planPath, plan);
  await writeJson(manifestPath, compileShotManifest(plan));
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, videoPlanToScriptMarkdown(plan), "utf8");

  return { slug, planPath, scriptPath, manifestPath };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    console.log(HELP_TEXT);
    return;
  }

  if (parsed.command === "doctor") {
    const result = await runDoctorCommand();
    console.log(result.output);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.command === "plan") {
    const result = await runPlanCommand(process.cwd(), parsed.briefPath);
    console.log(`Planning artifacts refreshed under projects/${result.slug}/`);
    return;
  }

  if (parsed.command === "director-mvp" || parsed.command === "run") {
    await runDirectorMvp(process.cwd(), parsed.briefPath);
    return;
  }

  await runMvp(process.cwd(), parsed.briefPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  });
}
