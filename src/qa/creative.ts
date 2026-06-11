import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ShotManifest } from "../domain/schemas.js";
import type { VideoPlan } from "../planning/director.js";

export type CreativeQaIssue = {
  severity: "info" | "warning" | "error";
  message: string;
};

export type CreativeQaReport = {
  project: string;
  voiceoverPath?: string;
  voiceover?: VoiceoverQaMetadata;
  issues: CreativeQaIssue[];
};

export type VoiceoverQaMetadata = {
  provider: "provided_audio" | "local_tts" | "local_placeholder";
  durationSeconds?: number;
  targetDurationSeconds?: number;
  tempoAdjustmentRatio?: number;
  timelineAdjusted?: boolean;
};

export type ValidateCreativeQaInput = {
  plan: VideoPlan;
  manifest: ShotManifest;
  voiceoverPath?: string;
  voiceover?: VoiceoverQaMetadata;
};

const REQUIRED_SHOT_FIELDS = [
  "chapterId",
  "sceneId",
  "beatId",
  "continuityId",
  "voiceoverStartSeconds",
  "voiceoverEndSeconds"
] as const;

const MAX_SAFE_TEMPO_DELTA = 0.08;

function markdownPathFor(jsonPath: string): string {
  return jsonPath.endsWith(".json") ? `${jsonPath.slice(0, -5)}.md` : `${jsonPath}.md`;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function formatIssues(issues: CreativeQaIssue[]): string {
  if (issues.length === 0) {
    return "No issues found";
  }

  return issues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n");
}

export function validateCreativeQa(input: ValidateCreativeQaInput): CreativeQaReport {
  const issues: CreativeQaIssue[] = [];

  if (!input.voiceoverPath?.trim()) {
    issues.push({
      severity: "warning",
      message: "voiceoverPath is missing or empty"
    });
  }

  validateVoiceoverMetadata(input.voiceover, issues);
  validateVoiceoverSegments(input.plan, issues);
  validateShots(input, issues);

  return {
    project: input.plan.project,
    ...(input.voiceoverPath !== undefined ? { voiceoverPath: input.voiceoverPath } : {}),
    ...(input.voiceover !== undefined ? { voiceover: input.voiceover } : {}),
    issues
  };
}

function validateVoiceoverMetadata(
  voiceover: VoiceoverQaMetadata | undefined,
  issues: CreativeQaIssue[]
): void {
  if (!voiceover) {
    return;
  }

  if (voiceover.provider === "local_placeholder") {
    issues.push({
      severity: "warning",
      message: "Voiceover provider local_placeholder is a fallback/debug voice and should not be used for product-facing MVP renders"
    });
  }

  if (
    voiceover.tempoAdjustmentRatio !== undefined
    && (
      voiceover.tempoAdjustmentRatio < 1 - MAX_SAFE_TEMPO_DELTA
      || voiceover.tempoAdjustmentRatio > 1 + MAX_SAFE_TEMPO_DELTA
    )
  ) {
    issues.push({
      severity: "warning",
      message: `Voiceover tempo adjustment ratio ${voiceover.tempoAdjustmentRatio} exceeds the safe narration correction range`
    });
  }
}

function validateVoiceoverSegments(plan: VideoPlan, issues: CreativeQaIssue[]): void {
  let previousEndSeconds = 0;

  plan.voiceoverSegments.forEach((segment, index) => {
    if (segment.endSeconds <= segment.startSeconds) {
      issues.push({
        severity: "error",
        message: `Voiceover segment ${segment.id} timing is not monotonic: endSeconds ${segment.endSeconds} is not after startSeconds ${segment.startSeconds}`
      });
    }

    if (index > 0 && segment.startSeconds < previousEndSeconds) {
      issues.push({
        severity: "error",
        message: `Voiceover segment ${segment.id} timing is not monotonic: startSeconds ${segment.startSeconds} is before previous endSeconds ${previousEndSeconds}`
      });
    }

    previousEndSeconds = Math.max(previousEndSeconds, segment.endSeconds);
  });
}

function validateShots(input: ValidateCreativeQaInput, issues: CreativeQaIssue[]): void {
  for (const shot of input.manifest.shots) {
    for (const field of REQUIRED_SHOT_FIELDS) {
      if (!hasValue(shot[field])) {
        issues.push({
          severity: "warning",
          message: `Shot ${shot.id} is missing ${field}`
        });
      }
    }

    if (shot.model !== input.plan.generationDefaults.model) {
      issues.push({
        severity: "warning",
        message: `Shot ${shot.id} model ${shot.model} does not match plan generation default ${input.plan.generationDefaults.model}`
      });
    }

    const resolution = shot.generation?.resolution;
    if (resolution !== input.plan.generationDefaults.resolution) {
      issues.push({
        severity: "warning",
        message: `Shot ${shot.id} generation resolution ${resolution ?? "missing"} does not match plan generation default ${input.plan.generationDefaults.resolution}`
      });
    }
  }
}

export function creativeQaMarkdown(report: CreativeQaReport): string {
  return [
    "# Creative QA Report",
    "",
    `Project: ${report.project}`,
    `Voiceover: ${report.voiceoverPath?.trim() ? report.voiceoverPath : "missing"}`,
    `Voiceover provider: ${report.voiceover?.provider ?? "unknown"}`,
    "",
    "## Issues",
    "",
    formatIssues(report.issues),
    ""
  ].join("\n");
}

export async function writeCreativeQaReport(jsonPath: string, report: CreativeQaReport): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPathFor(jsonPath), creativeQaMarkdown(report), "utf8");
}
