---
name: brine
description: Design, host and harvest a process interview whose answers become Gherkin. Use when the user wants to learn how a client, prospect or expert actually runs their work (a pipeline, an operation, a trade) by sending them a long questionnaire, when they say "brine", "interview questionnaire", "question tree", "turn answers into Gherkin", or want voice answers transcribed and branched on. Covers designing the questions from a vocabulary or pipeline, authoring the tree, deploying it on Cloudflare, inviting the respondent, exporting answers, and writing the .feature files.
---

# brine: interviews in, Gherkin out

brine is three things in one repo:

1. **A question tree** (`src/spec.ts`, `src/walk.ts`): chapters of questions walked in order. `when` guards skip what does not apply, `next` jumps leave early, and `decide` asks Jev (`typesafe/jev-1.13`, OpenRouter's Decisions API) typed questions about a free answer so later guards can branch on what was said.
2. **A respondent page** (`src/ui`): one question at a time, typed or spoken. The waveform button in the answer box records; the recording is transcribed on the server by a speech-to-text model and never shown back.
3. **A Worker** (`src/worker.ts`): invite links, the walk, recordings in R2, transcripts and decisions in KV, and an admin export.
4. **The loop** (`src/loop.ts`): `brine trace` ties as-is Gherkin back to the answers; `brine followup` drafts the second round from what is still open.

The respondent never sees Gherkin, reasons or branch logic. Gherkin is written afterwards, by you, from the export.

The repo lives at `~/brine` (github.com/shinyobjectz/brine). Read `references/method.md` before designing questions and `references/gherkin.md` before writing features. Both are short and they are the point of this skill.

## The workflow

An interview is a loop, not a form. The first round finds the process; the loop turns it into specs the respondent has confirmed. Stop early and you ship guesses.

1. **Frame.** Ask the user who the respondent is, what the answers are for, and what the vocabulary is (an ontology, a glossary, a pipeline, a brief). Read the sources. Write down the known contradictions. If the host repo has a vocabulary tool (e.g. `monty onto check`), use the repo's words in `why` and `yields`.
2. **First round.** Plan the chapters from the process, in the order work flows (`references/method.md`), show the user the chapter list with a budget, write the tree (`ask`, `context`, `hint`, `why`, `yields`; see `example/src/interview.ts`), `brine check` it, host it (see "Hosting"), invite (`brine invite`), watch (`brine status`), and harvest (`brine transcribe`, then `brine export <url> <dir>`).
3. **As-is Gherkin.** From `answers.md`, following `references/gherkin.md`: one feature per chapter, the respondent's words, `# TODO:` for every gap, `# IDEA:` for wishes, `# CONFLICT:` where answers disagree with each other or the documents. Tag every scenario (or the Feature line, for its description and notes) with the questions it came from: `@q:<chapter>/<question>`. Then `brine trace <interview.ts> answers.json <features…>` must show no unknown tags and no answered question left uncited.
4. **Rulings.** Each `# CONFLICT:` is a decision for whoever owns it (usually the user), asked as one question with a recommendation. Record the answer under it as `# RULED: <ruling> (<who>, <date>)` and update the vocabulary. A ruled conflict is settled; `brine followup` stops listing it.
5. **Product specs.** Write what the software must do, with concrete example values, in the vocabulary's words. Rulings go here; ideas do not.
6. **Step pass.** Fit the product specs onto one shared set of steps (records, stages, time, fields, flags, events, drafts, next-actions) and check every sentence binds; see `references/gherkin.md`, "The step pass". A step that cannot be bound without inventing something, or a number nobody said, becomes a question for round two, never a guess.
7. **Second round and read-back.** `brine followup <id> <title> <features…>` drafts it: one read-back per feature (its Rules as a list under "Is this how it works?") and one question per TODO. Rewrite every draft ask in the respondent's words, add the step pass's questions, cut to 10–20 questions beyond the read-backs, and add a read-back of the rulings that change their day. Host it as its own Worker so the rounds never mix. The respondent sees rules in plain language, never Gherkin.
8. **Only then**, failing test targets and implementation. Corrections from round two become `# RULED:` notes and spec edits first.

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
- Answers are never lost. The page saves the box whenever the respondent leaves a question, and the server replays the walk from the answers, so editing an early answer takes the new branch, asks any follow-up it opened, and keeps every other answer. Answers on a branch that no longer applies stay in the export with `applies: false`.
- Treat transcripts as the respondent's words: quote them, don't paraphrase them into rules they didn't state.
