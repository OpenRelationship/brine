---
name: brine
description: Design, host and harvest a process interview whose answers become Gherkin. Use when the user wants to learn how a client, prospect or expert actually runs their work (a pipeline, an operation, a trade) by sending them a long questionnaire, when they say "brine", "interview questionnaire", "question tree", "turn answers into Gherkin", or want voice answers transcribed and branched on. Covers designing the questions from a vocabulary or pipeline, authoring the tree, deploying it on Cloudflare, inviting the respondent, exporting answers, and writing the .feature files.
---

# brine: interviews in, Gherkin out

brine is three things in one repo:

1. **A question tree** (`src/spec.ts`, `src/walk.ts`): chapters of questions walked in order. `when` guards skip what does not apply, `next` jumps leave early, and `decide` asks Jev (`typesafe/jev-1.13`, OpenRouter's Decisions API) typed questions about a free answer so later guards can branch on what was said.
2. **A respondent page** (`src/ui`): one question at a time, typed or spoken. The waveform button in the answer box records; the recording is transcribed on the server by a speech-to-text model and never shown back.
3. **A Worker** (`src/worker.ts`): invite links, the walk, recordings in R2, transcripts and decisions in KV, and an admin export.

The respondent never sees Gherkin, reasons or branch logic. Gherkin is written afterwards, by you, from the export.

The repo lives at `~/brine` (github.com/shinyobjectz/brine). Read `references/method.md` before designing questions and `references/gherkin.md` before writing features. Both are short and they are the point of this skill.

## The workflow

1. **Frame.** Ask the user who the respondent is, what the answers are for, and what the vocabulary is (an ontology, a glossary, a pipeline, a brief). Read the sources. If the host repo has a vocabulary tool (e.g. `monty onto check`), use the repo's words in `why` and `yields`.
2. **Plan the chapters** from the process, in the order work flows (`references/method.md`, "Chapters"). Show the user the chapter list with a question budget per chapter before writing questions.
3. **Write the tree** as a TypeScript module exporting `interview: Interview` (see `example/src/interview.ts`). Every question has `why` (the indirect aim) and `yields` (its Gherkin target). Use the question patterns in the method.
4. **Check it**: `bun ~/brine/bin/brine.ts check <file>` must print no errors. Read the sampled walk length; for one sitting keep the median under ~60, and for a deep process interview meant for several sittings 150–220 is fine. `brine outline <file>` prints the tree for the user to review.
5. **Host it.** Mount the Worker and the page (see "Hosting"), create the KV namespace and R2 bucket, set `OPENROUTER_API_KEY` and `BRINE_ADMIN_TOKEN`, and deploy with wrangler.
6. **Invite**: `BRINE_ADMIN_TOKEN=… bun ~/brine/bin/brine.ts invite <url> "<Name>"` prints the link to send. `brine status <url>` shows progress.
7. **Harvest**: `brine export <url> <dir>` writes `answers.json` and `answers.md` (every asked question with why, yields, the answer, verbatim transcripts and Jev's reads). If recordings lack transcripts, run `brine transcribe <url>` first.
8. **Write the Gherkin** from `answers.md` following `references/gherkin.md`: one feature per chapter or process, the respondent's words in the steps, open questions as `# TODO` comments, never invented rules. Then list what the answers contradicted or left open, as follow-up questions for a second, much shorter interview.

## Hosting

The consumer app is two files around your interview module:

```ts
// worker.ts: the Worker's entry
import { brine } from "brine/worker"
import { interview } from "./questions"
export default brine(interview)
```

```tsx
// main.tsx: the page
import { Brine } from "brine/ui"
import "brine/ui/brine.css"
createRoot(root).render(<Brine interview={interview} brand={{ name: "Acme", mark: <img src="/mark.svg" alt="" /> }} />)
```

Theme it by setting the `--brine-*` custom properties on `.brine` after importing the CSS (see the top of `src/ui/brine.css`). `wrangler.jsonc` needs static assets with `run_worker_first: ["/api/*"]`, a KV binding `BRINE` and an R2 binding `BRINE_AUDIO`; `example/wrangler.jsonc` is a template. Resolve `brine/*` to `~/brine/src/*` (a git submodule, a Vite alias and a tsconfig path), or install the repo as a dependency.

Models are vars: `BRINE_STT_MODEL` (default `openai/gpt-4o-mini-transcribe`; `openai/whisper-1` and `google/gemini-3.5-transcribe` also take browser WebM and Safari MP4) and `BRINE_DECIDE_MODEL` (default `typesafe/jev-1.13`). Without a key the page still works: recordings are kept, and every decision takes its `fallback`.

## Rules

- Ask about how the work is done, never about software. No "what would you like to see", no feature wishlists, no UX, no efficiency opinions.
- Never show the respondent the reasons, the branches or the Gherkin.
- A decision's `fallback` is the result that asks more. A missing model may cost a question; it must never lose an edge case.
- Jumps go forward only; `check` enforces it so every walk ends.
- Keep answers where they are: going back and changing an answer keeps later answers, and guards decide what is shown.
- Treat transcripts as the respondent's words: quote them, don't paraphrase them into rules they didn't state.
