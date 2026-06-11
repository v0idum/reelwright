import test from "node:test";
import assert from "node:assert/strict";
import type { Brief } from "../src/domain/schemas.js";
import { createVideoPlan } from "../src/planning/director.js";
import {
  createPlanWithLocalLlm,
  extractJsonObject
} from "../src/planning/local-llm.js";

const baseLocalLlmBrief: Brief = {
  topic: "AI agents for service businesses",
  audience: "business operators",
  platforms: ["youtube", "shorts"],
  language: "en",
  tone: "clear and practical",
  cta: "Start with one workflow",
  targetDurationSeconds: 60,
  videoType: "guide",
  planning: {
    mode: "local_llm",
    provider: "ollama",
    model: "qwen2.5:7b",
    temperature: 0.3
  },
  styleReferences: [],
  constraints: []
};

test("createPlanWithLocalLlm sends Ollama generate requests and parses response JSON", async () => {
  const expectedPlan = createVideoPlan({ ...baseLocalLlmBrief, planning: { mode: "template" } });
  const requests: Array<{ url: string; init: RequestInit }> = [];

  const plan = await createPlanWithLocalLlm(baseLocalLlmBrief, {
    fetchJson: async (url, init) => {
      requests.push({ url, init });
      return { response: `Here is the JSON:\n${JSON.stringify(expectedPlan)}` };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1:11434/api/generate");
  const body = JSON.parse(String(requests[0]?.init.body)) as {
    model: string;
    stream: boolean;
    prompt: string;
    options: { temperature: number };
  };
  assert.equal(body.model, "qwen2.5:7b");
  assert.equal(body.stream, false);
  assert.equal(body.options.temperature, 0.3);
  assert.match(body.prompt, /Return only valid JSON/);
  assert.equal(plan.project, expectedPlan.project);
  assert.equal(plan.videoType, "guide");
});

test("createPlanWithLocalLlm sends LM Studio chat requests and parses completion JSON", async () => {
  const expectedPlan = createVideoPlan({
    ...baseLocalLlmBrief,
    planning: { mode: "template" }
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];

  const plan = await createPlanWithLocalLlm({
    ...baseLocalLlmBrief,
    planning: {
      mode: "local_llm",
      provider: "lm_studio",
      model: "local-model",
      endpoint: "http://127.0.0.1:1234/v1/chat/completions"
    }
  }, {
    fetchJson: async (url, init) => {
      requests.push({ url, init });
      return {
        choices: [{
          message: {
            content: JSON.stringify(expectedPlan)
          }
        }]
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1:1234/v1/chat/completions");
  const body = JSON.parse(String(requests[0]?.init.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
  };
  assert.equal(body.model, "local-model");
  assert.equal(body.messages[0]?.role, "system");
  assert.match(body.messages[1]?.content ?? "", /AI agents for service businesses/);
  assert.equal(body.temperature, 0.4);
  assert.equal(plan.project, expectedPlan.project);
});

test("createPlanWithLocalLlm rejects invalid JSON before generation", async () => {
  await assert.rejects(() => {
    return createPlanWithLocalLlm(baseLocalLlmBrief, {
      fetchJson: async () => ({ response: "not json" })
    });
  }, /valid JSON object/);
});

test("createPlanWithLocalLlm rejects JSON that does not match the VideoPlan contract", async () => {
  await assert.rejects(() => {
    return createPlanWithLocalLlm(baseLocalLlmBrief, {
      fetchJson: async () => ({ response: JSON.stringify({ project: "bad-plan" }) })
    });
  }, /Invalid local LLM video plan/);
});

test("createPlanWithLocalLlm rejects plans with long shots or broken references", async () => {
  const invalidPlan = createVideoPlan({ ...baseLocalLlmBrief, planning: { mode: "template" } });
  invalidPlan.plannedShots[0].endSeconds = invalidPlan.plannedShots[0].startSeconds + 31;
  invalidPlan.plannedShots[0].beatId = "missing-beat";

  await assert.rejects(() => {
    return createPlanWithLocalLlm(baseLocalLlmBrief, {
      fetchJson: async () => ({ response: JSON.stringify(invalidPlan) })
    });
  }, /Invalid local LLM video plan/);
});

test("extractJsonObject returns the first balanced JSON object", () => {
  assert.equal(extractJsonObject("prefix {\"a\":{\"b\":1}} suffix"), "{\"a\":{\"b\":1}}");
});
