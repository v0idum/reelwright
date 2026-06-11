import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QaIssue, QaReport } from "../domain/schemas.js";
import type { ProbeSummary } from "../ffmpeg/probe.js";

export type ValidateProbeInput = {
  expectedWidth: number;
  expectedHeight: number;
  expectedDurationSeconds: number;
  probe: ProbeSummary;
};

function markdownPathFor(jsonPath: string): string {
  return jsonPath.endsWith(".json") ? `${jsonPath.slice(0, -5)}.md` : `${jsonPath}.md`;
}

function formatIssues(issues: QaIssue[]): string {
  if (issues.length === 0) {
    return "No issues found";
  }

  return issues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n");
}

function reportMarkdown(report: QaReport): string {
  const resolution =
    report.actualWidth && report.actualHeight
      ? `${report.actualWidth}x${report.actualHeight} (expected ${report.expectedWidth}x${report.expectedHeight})`
      : `unknown (expected ${report.expectedWidth}x${report.expectedHeight})`;
  const duration =
    report.durationSeconds === undefined ? "unknown" : `${report.durationSeconds.toFixed(2)} seconds`;

  return [
    `# QA Report`,
    "",
    `Export: ${report.exportPath}`,
    `Resolution: ${resolution}`,
    `Duration: ${duration}`,
    "",
    `## Issues`,
    "",
    formatIssues(report.issues),
    ""
  ].join("\n");
}

export function validateProbe(exportPath: string, input: ValidateProbeInput): QaReport {
  const issues: QaIssue[] = [];
  const hasValidDuration = Number.isFinite(input.probe.durationSeconds) && input.probe.durationSeconds > 0;
  const hasValidBitrate = Number.isFinite(input.probe.bitrate) && input.probe.bitrate > 0;

  if (input.probe.width !== input.expectedWidth || input.probe.height !== input.expectedHeight) {
    issues.push({
      severity: "error",
      message: `Video resolution ${input.probe.width}x${input.probe.height} does not match expected ${input.expectedWidth}x${input.expectedHeight}`
    });
  }

  if (!hasValidDuration) {
    issues.push({
      severity: "warning",
      message: "Video duration was not reported"
    });
  } else if (Math.abs(input.probe.durationSeconds - input.expectedDurationSeconds) > 2) {
    issues.push({
      severity: "warning",
      message: `Video duration ${input.probe.durationSeconds.toFixed(2)}s differs from expected ${input.expectedDurationSeconds.toFixed(2)}s by more than 2s`
    });
  }

  if (!input.probe.hasAudio) {
    issues.push({
      severity: "warning",
      message: "No audio stream found"
    });
  }

  if (!hasValidBitrate) {
    issues.push({
      severity: "warning",
      message: "Video bitrate was not reported"
    });
  }

  return {
    exportPath,
    expectedWidth: input.expectedWidth,
    expectedHeight: input.expectedHeight,
    actualWidth: input.probe.width,
    actualHeight: input.probe.height,
    ...(hasValidDuration ? { durationSeconds: input.probe.durationSeconds } : {}),
    issues
  };
}

export async function writeQaReport(jsonPath: string, report: QaReport): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPathFor(jsonPath), reportMarkdown(report), "utf8");
}
