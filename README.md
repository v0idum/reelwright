# Reelwright

Reelwright is a CLI-first AI video production pipeline. It turns a JSON creative
brief into a video plan, script, shot manifest, Higgsfield generation jobs,
ffmpeg exports, captions, and QA reports.

The project is built for local use. Planning and validation can run without
spending generation credits; full rendering uses Higgsfield and ffmpeg.

## Quickstart

```bash
git clone https://github.com/v0idum/reelwright reelwright
cd reelwright
npm install
npm run demo:plan
```

`demo:plan` is safe to run first. It writes planning artifacts under
`projects/ai-video-workflow-demo/` without calling Higgsfield.

To check the full media toolchain:

```bash
npm run doctor
```

To run the full sample pipeline after the required tools are installed and
authenticated:

```bash
npm run demo:run
```

`demo:run` can call Higgsfield and may spend generation credits.

## What It Does

- Reads strict JSON briefs from `briefs/`.
- Creates `video-plan.json`, `script.md`, and `shot-manifest.json`.
- Generates planned clips through the Higgsfield CLI.
- Assembles 16:9 YouTube and 9:16 Shorts/Reels/TikTok exports with ffmpeg.
- Produces SRT captions.
- Writes machine-readable and Markdown QA reports.
- Keeps project state on disk so interrupted runs can be inspected and resumed.

## Requirements

Core:

- Node.js 20, pinned by `.nvmrc`.
- npm.

For full media generation:

- ffmpeg and ffprobe available on `PATH`.
- Higgsfield CLI installed and authenticated.
- A Higgsfield account with access to the model used by your brief.

Optional voiceover modes:

- `local_placeholder` uses macOS `/usr/bin/say`.
- `local_tts` uses local MLX-Audio/Kokoro tooling.
- `provided_audio` uses an audio file path from the brief.

Planning-only commands do not require Higgsfield, ffmpeg, or voiceover tooling.

## Higgsfield Setup

Install and authenticate the Higgsfield CLI before running commands that
generate media:

```bash
higgsfield --help
higgsfield auth status
```

Reelwright invokes Higgsfield with commands shaped like:

```bash
higgsfield generate create <model> \
  --prompt "<shot prompt>" \
  --duration <seconds> \
  --aspect_ratio 16:9 \
  --wait \
  --json
```

For Kling 3.0 and Seedance 2.0, Reelwright keeps requests within the duration
caps used by the pipeline.

## Commands

```bash
npm run doctor
npm run demo:plan
npm run demo:run
npm run reelwright -- --help
npm run reelwright -- plan <brief.json>
npm run reelwright -- run <brief.json>
npm run reelwright -- director-mvp <brief.json>
npm run reelwright -- mvp <brief.json>
```

Command notes:

- `doctor` checks Node, ffmpeg, ffprobe, and Higgsfield CLI availability.
- `demo:plan` runs the neutral sample brief through planning only.
- `demo:run` runs the neutral sample brief through the full pipeline.
- `plan` writes planning artifacts only and does not spend Higgsfield credits.
- `run` is the current director pipeline.
- `director-mvp` is a backwards-compatible alias for `run`.
- `mvp` runs the older MVP pipeline.

## Output

Each run writes project state under `projects/<slug>/`:

- `video-plan.json` - structured plan, scenes, beats, timing, and continuity.
- `script.md` - readable script generated from the plan.
- `shot-manifest.json` - generation-ready shot list.
- `media/generated/` - downloaded Higgsfield clips.
- `media/voiceover/` - generated or provided voiceover assets.
- `exports/` - rendered MP4 and SRT files.
- `reports/` - QA reports for rendered exports.

Runtime output is ignored by Git by default.

## Examples

The `examples/` directory contains small redacted artifacts for the neutral demo
brief:

- `examples/ai-video-workflow-demo/video-plan.json`
- `examples/ai-video-workflow-demo/shot-manifest.json`
- `examples/ai-video-workflow-demo/qa-report.json`

These files show the shape of Reelwright output without generated media, signed
download URLs, local machine paths, or account-specific identifiers.

## Brief Format

Briefs are JSON files. Minimal example:

```json
{
  "topic": "AI video workflow demo",
  "audience": "creators and operators building repeatable video systems",
  "platforms": ["youtube", "shorts"],
  "language": "en",
  "tone": "clear, practical, modern",
  "cta": "Turn one repeatable content idea into a structured video workflow",
  "targetDurationSeconds": 90,
  "videoType": "guide",
  "planning": { "mode": "template" },
  "generationDefaults": { "model": "kling3_0", "resolution": "720p" },
  "voiceover": { "mode": "local_placeholder" }
}
```

Supported `videoType` values include `explainer`, `guide`, `tutorial`,
`promo_ad`, `product_demo`, `story_episode`, `ugc_ad`, `documentary_short`, and
`social_short`.

## Voiceover

Choose one voiceover mode in the brief:

```json
{ "voiceover": { "mode": "local_placeholder" } }
```

Uses macOS `say`. Useful for quick local tests on macOS.

```json
{ "voiceover": { "mode": "provided_audio", "audioPath": "audio/voiceover.wav" } }
```

Uses a pre-recorded audio file.

```json
{
  "voiceover": {
    "mode": "local_tts",
    "engine": "mlx_audio",
    "model": "mlx-community/Kokoro-82M-4bit",
    "voice": "af_heart"
  }
}
```

Uses local open-model TTS.

## Local LLM Planning

Template planning is the default. Briefs can also use a local LLM planner:

```json
{
  "planning": {
    "mode": "local_llm",
    "provider": "ollama",
    "model": "qwen2.5:7b",
    "temperature": 0.3
  }
}
```

The planner asks the local model for structured JSON, extracts the first valid
JSON object, and rejects output that does not match the `VideoPlan` schema.

## Architecture

- `src/cli.ts` parses commands and routes pipeline actions.
- `src/domain/` holds schemas and project file helpers.
- `src/planning/` creates plans, scripts, and manifests.
- `src/higgsfield/` wraps Higgsfield command execution and media URL parsing.
- `src/audio/` handles placeholder, local TTS, and provided voiceover modes.
- `src/ffmpeg/` builds assembly and probing commands.
- `src/qa/` writes render and creative QA reports.
- `tests/` covers planning, generation boundaries, ffmpeg arguments, captions,
  resume behavior, and QA.

## Credit Safety

These commands do not call Higgsfield:

```bash
npm test
npm run typecheck
npm run validate
npm run demo:plan
npm run reelwright -- plan <brief.json>
```

These commands can call Higgsfield and may spend credits:

```bash
npm run demo:run
npm run reelwright -- run <brief.json>
npm run reelwright -- director-mvp <brief.json>
npm run reelwright -- mvp <brief.json>
```

Review the brief, model, duration, and voiceover settings before running full
generation.

## Troubleshooting

- `doctor` reports missing ffmpeg or ffprobe: install ffmpeg and make sure both
  commands are on `PATH`.
- `doctor` reports missing Higgsfield: install and authenticate the Higgsfield
  CLI, then rerun `npm run doctor`.
- Full generation fails on Linux or Windows with `/usr/bin/say`: use
  `provided_audio` or `local_tts` instead of `local_placeholder`.
- A run stops after some clips are generated: inspect
  `projects/<slug>/shot-manifest.json`; generated shots keep their status and
  local paths for resume.

## Development

```bash
npm run typecheck
npm test
npm run validate
```

Tests use injected adapters for Higgsfield, ffmpeg, and voiceover work so they
can validate orchestration without live media generation.

## License

MIT
