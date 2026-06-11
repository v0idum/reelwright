import type { Brief } from "../domain/schemas.js";
import {
  parseVideoPlan,
  type VideoPlan
} from "./director.js";

export type LocalLlmPlannerDependencies = {
  fetchJson: (url: string, init: RequestInit) => Promise<unknown>;
};

type LocalLlmPlanning = Extract<NonNullable<Brief["planning"]>, { mode: "local_llm" }>;

const OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate";
const LM_STUDIO_ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions";

const DEFAULT_DEPENDENCIES: LocalLlmPlannerDependencies = {
  fetchJson: async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`local LLM request failed with HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
};

export async function createPlanWithLocalLlm(
  brief: Brief,
  dependencies: LocalLlmPlannerDependencies = DEFAULT_DEPENDENCIES
): Promise<VideoPlan> {
  const planning = brief.planning;
  if (planning?.mode !== "local_llm") {
    throw new Error("createPlanWithLocalLlm requires brief.planning.mode to be local_llm");
  }

  const response = planning.provider === "ollama"
    ? await requestOllamaPlan(brief, planning, dependencies)
    : await requestLmStudioPlan(brief, planning, dependencies);
  const content = extractModelContent(response, planning.provider);
  const json = extractJsonObject(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`local LLM did not return a valid JSON object: ${errorMessage(error)}`);
  }

  try {
    return parseVideoPlan(parsed);
  } catch (error) {
    throw new Error(`Invalid local LLM video plan: ${errorMessage(error)}`);
  }
}

export function extractJsonObject(value: string): string {
  const start = value.indexOf("{");
  if (start === -1) {
    throw new Error("local LLM did not return a valid JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  throw new Error("local LLM did not return a valid JSON object");
}

async function requestOllamaPlan(
  brief: Brief,
  planning: LocalLlmPlanning,
  dependencies: LocalLlmPlannerDependencies
): Promise<unknown> {
  return dependencies.fetchJson(planning.endpoint ?? OLLAMA_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: planning.model,
      prompt: buildPlannerPrompt(brief),
      stream: false,
      options: {
        temperature: planning.temperature ?? 0.4
      }
    })
  });
}

async function requestLmStudioPlan(
  brief: Brief,
  planning: LocalLlmPlanning,
  dependencies: LocalLlmPlannerDependencies
): Promise<unknown> {
  return dependencies.fetchJson(planning.endpoint ?? LM_STUDIO_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: planning.model,
      messages: [
        {
          role: "system",
          content: "You are Reelwright's local video director planner. Return only valid JSON."
        },
        {
          role: "user",
          content: buildPlannerPrompt(brief)
        }
      ],
      temperature: planning.temperature ?? 0.4
    })
  });
}

function buildPlannerPrompt(brief: Brief): string {
  return [
    "Return only valid JSON for a Reelwright VideoPlan.",
    "The JSON must include: project, topic, videoType, targetDurationSeconds, speaker, audience, platforms, language, tone, cta, brandStyle, continuityMode, platformPackage, assets, visualStyle, promptSafetyRules, generationDefaults, continuityAnchors, chapters, scenes, beats, voiceoverSegments, plannedShots.",
    "Every planned shot duration must be 30 seconds or less.",
    "Every planned shot must link to chapterId, sceneId, beatId, and continuityId.",
    "The plan must be ready for deterministic manifest compilation before any Higgsfield generation.",
    "Creative brief:",
    JSON.stringify(brief, null, 2)
  ].join("\n");
}

function extractModelContent(response: unknown, provider: "ollama" | "lm_studio"): string {
  if (provider === "ollama") {
    const content = getStringProperty(response, "response");
    if (content) {
      return content;
    }
    throw new Error("Ollama response did not include a response string");
  }

  const choices = getArrayProperty(response, "choices");
  const firstChoice = choices[0];
  const message = getObjectProperty(firstChoice, "message");
  const content = getStringProperty(message, "content");
  if (content) {
    return content;
  }

  throw new Error("LM Studio response did not include choices[0].message.content");
}

function getObjectProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const property = (value as Record<string, unknown>)[key];
  return property && typeof property === "object"
    ? property as Record<string, unknown>
    : undefined;
}

function getArrayProperty(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const property = (value as Record<string, unknown>)[key];
  return Array.isArray(property) ? property : [];
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
