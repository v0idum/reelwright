import type {
  Brief,
  VideoType
} from "../domain/schemas.js";

type ShotRole = "hook" | "explain" | "proof" | "transition" | "cta" | "broll";

export type DirectorBeatTemplate = {
  sceneTitle: string;
  scenePurpose: string;
  beatTitle: string;
  role: ShotRole;
  text: (brief: Brief) => string;
  visual: (brief: Brief) => string;
  camera: string;
};

export type DirectorTemplate = {
  id: VideoType;
  chapterTitle: string;
  continuityId: string;
  visualStyle: string;
  defaultContinuity: string[];
  baseTargetSeconds: number;
  baseDurations: number[];
  beats: DirectorBeatTemplate[];
};

const EXPLAINER_BEATS: DirectorBeatTemplate[] = [
  {
    sceneTitle: "Hook",
    scenePurpose: "Name the retention mechanic immediately.",
    beatTitle: "Prediction gap",
    role: "hook",
    text: (brief) => explainerText(brief, "hook"),
    visual: (brief) => explainerVisual(brief, "hook"),
    camera: "macro push toward the phone, circular swipe motion repeats in the reflection"
  },
  {
    sceneTitle: "Reward loop",
    scenePurpose: "Explain the variable reward pattern.",
    beatTitle: "Variable reward",
    role: "explain",
    text: (brief) => explainerText(brief, "mechanism"),
    visual: (brief) => explainerVisual(brief, "mechanism"),
    camera: "slow lateral move across timeline tiles, match cut on each pulse"
  },
  {
    sceneTitle: "Reward loop",
    scenePurpose: "Explain the variable reward pattern.",
    beatTitle: "Micro payoff",
    role: "proof",
    text: (brief) => explainerText(brief, "proof"),
    visual: (brief) => explainerVisual(brief, "proof"),
    camera: "locked-off desk shot with waveform animation reflected on the phone glass"
  },
  {
    sceneTitle: "Pacing",
    scenePurpose: "Show how speed prevents reflection.",
    beatTitle: "No exit ramp",
    role: "transition",
    text: (brief) => explainerText(brief, "transition"),
    visual: (brief) => explainerVisual(brief, "transition"),
    camera: "four quick cuts connected by the same clockwise motion"
  },
  {
    sceneTitle: "Pacing",
    scenePurpose: "Show how speed prevents reflection.",
    beatTitle: "Pattern lock",
    role: "broll",
    text: (brief) => explainerText(brief, "pattern"),
    visual: (brief) => explainerVisual(brief, "pattern"),
    camera: "top-down desk shot, slow zoom as each loop node lights"
  },
  {
    sceneTitle: "Creator lesson",
    scenePurpose: "Translate the mechanic into a useful production lesson.",
    beatTitle: "Use the loop honestly",
    role: "explain",
    text: (brief) => explainerText(brief, "lesson"),
    visual: (brief) => explainerVisual(brief, "lesson"),
    camera: "over-shoulder edit bay shot with a deliberate slow push"
  },
  {
    sceneTitle: "CTA",
    scenePurpose: "Close with the productized workflow.",
    beatTitle: "Systemize it",
    role: "cta",
    text: (brief) => explainerText(brief, "cta"),
    visual: (brief) => explainerVisual(brief, "cta"),
    camera: "wide studio reveal, then gentle push into the final timeline"
  }
];

const GUIDE_BEATS: DirectorBeatTemplate[] = [
  {
    sceneTitle: "Opening",
    scenePurpose: "Frame AI agents as practical operating help, not abstract technology.",
    beatTitle: "Business-first hook",
    role: "hook",
    text: (brief) => isRussian(brief)
      ? "AI-агенты полезны бизнесу не потому, что это модная технология. Они полезны там, где каждый день повторяются заявки, сообщения, документы, звонки и решения, которые забирают время команды."
      : "AI agents become useful when a business has repeated requests, messages, documents, calls, and decisions that consume the team's time every day.",
    visual: () => "A modern service-business operations desk connects customer messages, CRM cards, a dispatch map, and KPI panels into one coherent workflow.",
    camera: "slow push from the whole operations desk into the first customer request"
  },
  {
    sceneTitle: "Opening",
    scenePurpose: "Anchor the everyday operations context.",
    beatTitle: "Service business context",
    role: "explain",
    text: (brief) => isRussian(brief)
      ? "Это особенно заметно в рознице, ресторанах, клиниках, логистике и продажах: клиенты пишут быстро, ждут ответа сразу, а менеджеры часто работают вручную."
      : "This is visible in retail, restaurants, clinics, logistics, and sales: customers message quickly, expect fast answers, and teams still handle too much manually.",
    visual: () => "A connected city-business montage shows retail, restaurant, clinic, warehouse, and sales office workflows sharing the same clean visual system.",
    camera: "match cuts across five business environments using the same blue-white interface glow"
  },
  {
    sceneTitle: "Use cases",
    scenePurpose: "Show customer support automation.",
    beatTitle: "Retail support",
    role: "proof",
    text: (brief) => isRussian(brief)
      ? "Первый сценарий — розница. Агент отвечает на вопросы о наличии, размере, доставке и возврате, собирает данные клиента и передает менеджеру уже подготовленный диалог."
      : "First: retail support. An agent answers stock, sizing, delivery, and return questions, collects customer details, and hands the manager a prepared conversation.",
    visual: () => "A retail customer message queue becomes organized into answered questions, order details, and a clean handoff card.",
    camera: "top-down desk shot, message cards snap into an orderly customer profile"
  },
  {
    sceneTitle: "Use cases",
    scenePurpose: "Show booking and ordering workflows.",
    beatTitle: "Restaurants and bookings",
    role: "proof",
    text: (brief) => isRussian(brief)
      ? "В ресторанах агент может принимать брони, уточнять время, количество гостей, предпочтения, а для доставки — помогать с повторными заказами и статусом."
      : "For restaurants, an agent can handle bookings, confirm time, guest count, preferences, and help delivery customers with repeat orders and status updates.",
    visual: () => "Restaurant reservation tiles, delivery order cards, and a warm operations dashboard update in one connected flow.",
    camera: "gentle lateral move across reservation, kitchen, and delivery panels"
  },
  {
    sceneTitle: "Use cases",
    scenePurpose: "Show clinic workflow automation.",
    beatTitle: "Clinic appointments",
    role: "proof",
    text: (brief) => isRussian(brief)
      ? "В клиниках агент не заменяет врача. Он помогает записать пациента, напомнить о визите, собрать базовые данные и разгрузить администратора от повторяющихся звонков."
      : "In clinics, an agent does not replace the doctor. It schedules patients, sends reminders, gathers basic information, and reduces repetitive admin calls.",
    visual: () => "A clinic front desk workflow shows appointment slots, reminder cards, and a patient intake checklist without readable private data.",
    camera: "calm push across appointment timeline and neutral patient intake cards"
  },
  {
    sceneTitle: "Use cases",
    scenePurpose: "Show logistics and dispatch impact.",
    beatTitle: "Logistics dispatch",
    role: "proof",
    text: (brief) => isRussian(brief)
      ? "В логистике агент может собрать адрес, время, тип груза, проверить недостающие детали и подготовить задачу для диспетчера без длинной переписки."
      : "In logistics, an agent can collect address, timing, cargo type, missing details, and prepare a dispatch task without long back-and-forth messages.",
    visual: () => "A dispatch map, route cards, cargo notes, and driver task queue align into a clean logistics control view.",
    camera: "map-level push-in, then match cut to organized dispatch cards"
  },
  {
    sceneTitle: "Use cases",
    scenePurpose: "Show sales follow-up and CRM hygiene.",
    beatTitle: "Sales follow-up",
    role: "proof",
    text: (brief) => isRussian(brief)
      ? "В продажах агент напоминает о лидах, готовит follow-up, фиксирует возражения, обновляет CRM и помогает менеджеру не терять теплые контакты."
      : "In sales, an agent reminds the team about leads, prepares follow-ups, records objections, updates the CRM, and helps managers avoid losing warm contacts.",
    visual: () => "Sales leads move from messy notes into a clean CRM pipeline with follow-up reminders and manager handoff cards.",
    camera: "over-shoulder CRM view, slow push as leads become prioritized"
  },
  {
    sceneTitle: "Integration",
    scenePurpose: "Explain how to integrate agents safely.",
    beatTitle: "Start narrow",
    role: "explain",
    text: (brief) => isRussian(brief)
      ? "Правильное внедрение начинается не с большого проекта. Выберите один узкий процесс: заявки, записи, ответы, документы или отчеты. Опишите правила и подключите агента сначала к этому участку."
      : "Good implementation does not start with a huge project. Choose one narrow process: requests, bookings, answers, documents, or reports. Define the rules and connect the agent there first.",
    visual: () => "A single process lane is highlighted from a larger business operations map, with inputs, rules, review, and handoff clearly separated.",
    camera: "wide operations map narrows into one highlighted automation lane"
  },
  {
    sceneTitle: "Integration",
    scenePurpose: "Explain human review and system boundaries.",
    beatTitle: "Human approval",
    role: "explain",
    text: (brief) => isRussian(brief)
      ? "На первом этапе агент не должен принимать рискованные решения сам. Он собирает информацию, предлагает ответ, создает задачу, а человек утверждает важные действия."
      : "At first, the agent should not make risky decisions alone. It collects information, drafts responses, creates tasks, and a human approves important actions.",
    visual: () => "An approval checkpoint sits between agent-prepared cards and final business actions, making human review visually clear.",
    camera: "locked-off approval station, cards move through a visible review gate"
  },
  {
    sceneTitle: "Benefits",
    scenePurpose: "Make the value concrete.",
    beatTitle: "Benefits",
    role: "broll",
    text: (brief) => isRussian(brief)
      ? "Польза обычно видна в трех местах: быстрее первый ответ, меньше ручной рутины, лучше контроль процесса. Команда видит, что происходит, а клиент получает ответ без ожидания."
      : "The value usually appears in three places: faster first response, less manual routine, and better process control. The team sees what is happening and the customer waits less.",
    visual: () => "Three KPI cards animate as first response, manual workload, and process visibility improve across the same operations dashboard.",
    camera: "clean dashboard push, three metric cards light up in sequence"
  },
  {
    sceneTitle: "Benefits",
    scenePurpose: "Warn against generic hype.",
    beatTitle: "Avoid hype",
    role: "transition",
    text: (brief) => isRussian(brief)
      ? "Главная ошибка — внедрять AI ради AI. Сильный агент должен быть привязан к понятной задаче, понятным данным, понятной ответственности и измеримому результату."
      : "The main mistake is adopting AI for its own sake. A strong agent is tied to a clear task, clear data, clear responsibility, and a measurable outcome.",
    visual: () => "Abstract AI hype dissolves into a practical checklist: task, data, responsibility, measurable result, without readable text.",
    camera: "soft transition from abstract glow to practical operations board"
  },
  {
    sceneTitle: "CTA",
    scenePurpose: "Close with a concrete next action.",
    beatTitle: "One process this week",
    role: "cta",
    text: (brief) => isRussian(brief)
      ? `${brief.cta}. Начните с маленького процесса, проверьте качество ответов, оставьте контроль у команды и масштабируйте только то, что реально экономит время.`
      : `${brief.cta}. Start with a small process, check response quality, keep the team in control, and scale only what genuinely saves time.`,
    visual: () => "The full business operations system resolves into one clear next-step workflow with agent, human review, and export-ready video polish.",
    camera: "wide reveal of the connected business workflow, then final push into the selected process lane"
  }
];

const EXPLAINER_TEMPLATE: DirectorTemplate = {
  id: "explainer",
  chapterTitle: "Why the loop works",
  continuityId: "creator-studio-attention-loop",
  visualStyle: "Cinematic social video with premium creator explainer lighting",
  defaultContinuity: [
    "one dark creator studio",
    "same phone, desk, waveform monitor, and editing timeline motif",
    "electric cyan, warm amber, and neutral graphite palette",
    "macro shots, slow pushes, match cuts, and repeated circular swipe motion"
  ],
  baseTargetSeconds: 75,
  baseDurations: [8, 10, 11, 11, 10, 12, 13],
  beats: EXPLAINER_BEATS
};

const GUIDE_TEMPLATE: DirectorTemplate = {
  id: "guide",
  chapterTitle: "Practical implementation guide",
  continuityId: "business-operations-agent-system",
  visualStyle: "Premium business guide video with modern operations dashboards, cinematic office lighting, and practical AI workflow visuals",
  defaultContinuity: [
    "one coherent business operations world",
    "recurring customer message queue, CRM pipeline, dispatch map, appointment calendar, and KPI cards",
    "blue, white, graphite, and warm city-light palette",
    "smooth camera moves, match cuts between use cases, no readable interface text"
  ],
  baseTargetSeconds: 120,
  baseDurations: [9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11],
  beats: GUIDE_BEATS
};

const PROMO_TEMPLATE = createSimpleTemplate({
  id: "promo_ad",
  chapterTitle: "Problem to offer",
  continuityId: "brand-offer-system",
  visualStyle: "Premium conversion-focused promo video with polished product visuals and clear business value",
  sceneTitles: ["Problem", "Promise", "Proof", "Offer", "CTA"],
  roles: ["hook", "explain", "proof", "explain", "cta"]
});

const PRODUCT_DEMO_TEMPLATE = createSimpleTemplate({
  id: "product_demo",
  chapterTitle: "Product walkthrough",
  continuityId: "product-demo-system",
  visualStyle: "Clean product demo video with practical workflows, product closeups, and premium motion",
  sceneTitles: ["Pain", "Context", "Feature", "Use case", "CTA"],
  roles: ["hook", "explain", "proof", "broll", "cta"]
});

const TUTORIAL_TEMPLATE = createSimpleTemplate({
  id: "tutorial",
  chapterTitle: "Step-by-step walkthrough",
  continuityId: "tutorial-workflow-system",
  visualStyle: "Polished tutorial video with clean process visuals, direct instruction, and clear before-after structure",
  sceneTitles: ["Goal", "Setup", "Steps", "Mistakes", "Outcome", "CTA"],
  roles: ["hook", "explain", "explain", "transition", "proof", "cta"]
});

const STORY_EPISODE_TEMPLATE = createSimpleTemplate({
  id: "story_episode",
  chapterTitle: "Episode arc",
  continuityId: "story-world-system",
  visualStyle: "Cinematic story episode with consistent world rules, character-safe silhouettes, and dramatic business stakes",
  sceneTitles: ["Hook", "Situation", "Conflict", "Decision", "Result", "CTA"],
  roles: ["hook", "explain", "transition", "explain", "proof", "cta"]
});

const SOCIAL_SHORT_TEMPLATE = createSimpleTemplate({
  id: "social_short",
  chapterTitle: "Short social arc",
  continuityId: "social-short-system",
  visualStyle: "Fast premium social video with bold visual rhythm, clean captions, and high-retention motion",
  sceneTitles: ["Hook", "Point", "Proof", "CTA"],
  roles: ["hook", "explain", "proof", "cta"],
  baseTargetSeconds: 45,
  baseDurations: [8, 12, 13, 12]
});

export function selectDirectorTemplate(brief: Brief): DirectorTemplate {
  switch (brief.videoType ?? "explainer") {
    case "guide":
    case "documentary_short":
      return GUIDE_TEMPLATE;
    case "promo_ad":
    case "ugc_ad":
      return PROMO_TEMPLATE;
    case "product_demo":
      return PRODUCT_DEMO_TEMPLATE;
    case "tutorial":
      return TUTORIAL_TEMPLATE;
    case "story_episode":
      return STORY_EPISODE_TEMPLATE;
    case "social_short":
      return SOCIAL_SHORT_TEMPLATE;
    case "explainer":
    default:
      return EXPLAINER_TEMPLATE;
  }
}

function createSimpleTemplate(options: {
  id: VideoType;
  chapterTitle: string;
  continuityId: string;
  visualStyle: string;
  sceneTitles: string[];
  roles: ShotRole[];
  baseTargetSeconds?: number;
  baseDurations?: number[];
}): DirectorTemplate {
  return {
    id: options.id,
    chapterTitle: options.chapterTitle,
    continuityId: options.continuityId,
    visualStyle: options.visualStyle,
    defaultContinuity: [
      "one coherent branded production world",
      "recurring product, process, audience, and outcome motifs",
      "clean premium lighting with restrained motion graphics",
      "consistent camera movement and match-cut transitions"
    ],
    baseTargetSeconds: options.baseTargetSeconds ?? 60,
    baseDurations: options.baseDurations ?? options.sceneTitles.map(() => {
      return Math.round((options.baseTargetSeconds ?? 60) / options.sceneTitles.length);
    }),
    beats: options.sceneTitles.map((sceneTitle, index) => {
      const role = options.roles[index] ?? "explain";
      return {
        sceneTitle,
        scenePurpose: `Advance the ${options.id.replace(/_/g, " ")} structure through ${sceneTitle.toLowerCase()}.`,
        beatTitle: sceneTitle,
        role,
        text: (brief: Brief) => buildGenericText(brief, sceneTitle, role),
        visual: (brief: Brief) => buildGenericVisual(brief, sceneTitle),
        camera: "smooth push with clean match-cut transition into the next beat"
      };
    })
  };
}

function buildGenericText(brief: Brief, sceneTitle: string, role: ShotRole): string {
  const offer = brief.productOrOffer ?? brief.topic;
  const goal = brief.primaryGoal ?? "make the idea useful and concrete";

  if (role === "cta") {
    return `${brief.cta}. Connect ${offer} to one specific next action, then show the audience how to move forward without adding unnecessary complexity.`;
  }

  return `${sceneTitle}: explain ${brief.topic} for ${brief.audience}. Keep the point practical, connect it to ${offer}, and make the goal clear: ${goal}.`;
}

function buildGenericVisual(brief: Brief, sceneTitle: string): string {
  const offer = brief.productOrOffer ?? brief.topic;
  return `A polished ${sceneTitle.toLowerCase()} scene showing ${offer} through practical objects, process cards, and premium creator-style motion.`;
}

function explainerText(brief: Brief, key: string): string {
  if (isShortFormAddictionBrief(brief)) {
    return legacyShortFormText(brief, key);
  }

  const offer = brief.productOrOffer ?? brief.topic;
  const goal = brief.primaryGoal ?? "make the concept clear and useful";

  switch (key) {
    case "hook":
      return `${brief.topic} is easier to understand when the mechanism is visible. Start with the real situation, name the friction, and show why this matters for ${brief.audience}.`;
    case "mechanism":
      return `The core idea is not abstract: ${offer} connects a repeated problem, a clear input, a decision rule, and a useful output that the audience can inspect.`;
    case "proof":
      return `A strong example proves the point quickly. Show one realistic workflow, what changes inside it, and how the result supports the goal: ${goal}.`;
    case "transition":
      return `Now move from concept to application. Keep the same visual world, but shift from the big idea into the concrete steps that make ${brief.topic} practical.`;
    case "pattern":
      return `The pattern is simple: identify the repeatable work, define the rules, keep human review where it matters, and measure the improvement before scaling.`;
    case "lesson":
      return `The useful lesson for ${brief.audience} is to start narrow. A focused implementation is easier to trust, easier to measure, and easier to improve.`;
    case "cta":
      return `${brief.cta}. Turn ${brief.topic} into one concrete next step, then build from the process that saves the most time or creates the clearest result.`;
    default:
      return `Explain ${brief.topic} for ${brief.audience} with a concrete example and a practical next step.`;
  }
}

function explainerVisual(brief: Brief, key: string): string {
  if (isShortFormAddictionBrief(brief)) {
    return legacyShortFormVisual(key);
  }

  const offer = brief.productOrOffer ?? brief.topic;
  switch (key) {
    case "hook":
      return `A premium opening shot visualizes ${brief.topic} as a concrete system with people, inputs, decisions, and outcomes.`;
    case "mechanism":
      return `A clean workflow diagram becomes a cinematic operations scene showing how ${offer} moves from input to useful output.`;
    case "proof":
      return `One realistic example of ${brief.topic} plays out through practical objects, process cards, and measured results.`;
    case "transition":
      return `A match cut moves from the high-level idea into the first practical implementation step for ${brief.audience}.`;
    case "pattern":
      return `A repeated process loop highlights inputs, rules, human review, measurement, and scale points without readable UI text.`;
    case "lesson":
      return `A focused team chooses one narrow workflow, tests ${offer}, and reviews the result on a clean operations dashboard.`;
    case "cta":
      return `The final shot resolves ${brief.topic} into one selected next-step workflow and a clear action path.`;
    default:
      return `A polished explainer scene showing ${brief.topic} through practical process visuals.`;
  }
}

function legacyShortFormText(brief: Brief, key: string): string {
  switch (key) {
    case "hook":
      return "Short-form does not feel addictive by accident. It opens a loop before your brain can decide to leave, then makes the next answer feel one swipe away.";
    case "mechanism":
      return "Every swipe asks a tiny question: will the next clip be boring, useful, funny, or weirdly perfect? Because the answer changes, your attention keeps checking.";
    case "proof":
      return "That uncertainty is the engine. The reward is small, but the check is instant, so the habit gets cheap to repeat and hard to consciously interrupt.";
    case "transition":
      return "Then pacing removes the exit ramp: cuts land before boredom has time to form a full sentence, and each visual change resets the clock.";
    case "pattern":
      return "The viewer is not just watching clips. They are tracking patterns, waiting for closure, and getting reset by motion, sound, captions, and timing.";
    case "lesson":
      return "For creators, the lesson is not to trick people. It is to make the next useful moment obvious enough to earn another second, then deliver on it quickly and clearly.";
    case "cta":
      return `${brief.cta}. Plan the loop, keep the world consistent, align narration before generation, and make every shot earn its place in the finished edit.`;
    default:
      return brief.topic;
  }
}

function legacyShortFormVisual(key: string): string {
  switch (key) {
    case "hook":
      return "A thumb hovers over a glowing phone while a half-finished progress ring freezes mid-swipe.";
    case "mechanism":
      return "The editing timeline becomes a slot-like row of clips, each tile pulsing with a different color cue.";
    case "proof":
      return "Waveform spikes sync to a notification-like flash, then collapse into a clean retention curve.";
    case "transition":
      return "Fast match cuts connect hand, phone, waveform monitor, and timeline marker around the same circular movement.";
    case "pattern":
      return "A loop diagram overlays the studio desk, with attention, prediction, reward, and reset points lighting in sequence.";
    case "lesson":
      return "A creator trims a clip, labels the next beat, and aligns narration to a clean visual payoff.";
    case "cta":
      return "The finished timeline resolves into a tidy video system: script, shots, voiceover, and export lined up on one desk.";
    default:
      return "A premium creator explainer visual.";
  }
}

function isShortFormAddictionBrief(brief: Brief): boolean {
  return /short[- ]form/i.test(brief.topic) && /addict/i.test(brief.topic);
}

function isRussian(brief: Brief): boolean {
  return /^(ru|rus|russian|рус)/i.test(brief.language);
}
