---
name: brine
description: Model how work actually happens before building software for it. Interview the people who do the work (a team, a customer, a client, an expert) with a voice question tree, then turn the answers into Gherkin specs and a typed fact ledger. Use when planning an internal tool and its tech stack, planning an app around a customer, client or user, writing down how a specialist does a job, or when the user says "brine", "behavior model", "discovery interview", "requirements interview", "question tree" or "turn answers into Gherkin". Covers designing the questions, hosting the interview on Cloudflare with voice answers, exporting them, writing traced .feature files, and projecting the answers into constants, timers, templates, fixtures, eval cases, a backlog and a risk register.
---

# brine: model the behavior before you build it

Plan software from how the work actually happens, not from what people say they want. Typical uses:

- **An internal tool.** Interview the team that runs the process (an agency's request-to-delivery flow, a warehouse's returns desk). The answers sort each step into rules (code), judgment calls (a person, or a model with evals from real cases) and hand-offs, and name the systems and records each step touches. That is the stack.
- **An app around a customer, client or user.** Model their process first: the states a record moves through, the clocks behind reminders, the messages they send, the exceptions they handle by hand.
- **A specialist's process**, such as an estimator pricing a job or a payroll lead closing the month, written down in their own words so the team and its software work to the same spec.

brine is five things in one repo (https://github.com/shinyobjectz/brine, Apache-2.0):

1. **A question tree** (`src/spec.ts`, `src/walk.ts`): chapters of questions walked in order. `when` guards skip what does not apply, `next` jumps leave early, and `decide` asks a decision model (default `typesafe/jev-1.13` through OpenRouter) typed questions about a free answer so later guards can branch on what was said.
2. **A respondent page** (`src/ui`): one question at a time, typed or spoken. The waveform button in the answer box records; the recording is transcribed on the server by a speech-to-text model and never shown back.
3. **A Worker** (`src/worker.ts`): invite links and passcodes, each respondent's walk in its own Durable Object, recordings and an append-only answer log in R2, transcripts and decisions in KV, and an admin export.
4. **The loop** (`src/loop.ts`): `brine trace` ties as-is Gherkin back to the answers; `brine followup` drafts a second round from what is still open.
5. **The fact ledger** (`src/ledger.ts`): everything that is not behavior (numbers, timers, rules, wording, stories, signals, terms, ideas, risks, metrics) as typed facts cited to answers; `brine ledger check|render|emit|records` projects it into code, documents and retrieval records.

The respondent never sees Gherkin, reasons or branch logic. Gherkin is written afterwards, by you, from the export.

Read `references/method.md` before designing questions, `references/gherkin.md` before writing features, and `references/derivations.md` before writing the ledger. They are short and they are the point of this skill.

## Getting brine

This skill is the method; the code lives in the repo. Before running any `brine` command, find a checkout (look for a directory with `bin/brine.ts` and `src/walk.ts`, e.g. `~/brine` or a `brine` submodule in the user's project). If there is none, clone it and install:

```sh
git clone https://github.com/shinyobjectz/brine ~/brine
cd ~/brine && bun install && bun test
```

It needs [Bun](https://bun.sh). Hosting needs a Cloudflare account and `wrangler`, and transcription and decisions need an OpenRouter key; ask the user before creating Cloudflare resources or setting secrets. In a project, add the repo as a git submodule (or a dependency) and resolve `brine/*` to its `src/*` with a Vite alias and a tsconfig path; `example/` in the repo is a complete app to copy.

### Commands

Run as `bun <brine>/bin/brine.ts <command>`. Commands that take a URL need `BRINE_ADMIN_TOKEN` in the environment.

| Command | Does |
| --- | --- |
| `check <interview.ts>` | lint the tree (addresses resolve, jumps go forward, guards look back) and estimate a sitting's length |
| `outline <interview.ts>` | every question with its guard, why and yields, as markdown to show the user |
| `card <interview.ts> --company <name>` | the share card (`card.png`, 1200×630) for the invite link: the company, the heading, and how long a sitting takes; `--heading`, `--body`, `--mark logo`, `--font file.ttf`, `--out dir` |
| `invite <url> <name>` | make an invite link for a respondent |
| `passcode <url> <code> <passcode>` | let that respondent in by typing a passcode on the bare site |
| `status <url>` | who is how far |
| `transcribe <url>` | retry every recording without a transcript |
| `export <url> [dir]` | write `answers.json` and `answers.md` |
| `revoke <url> <code>` | delete an invite, its answers and its recordings |
| `trace <interview.ts> <answers.json> <features…>` | every `@q:` tag resolves; lists answers no scenario cites |
| `followup <id> <title> <features…>` | draft a second round (read-backs and TODOs) as a TS module |
| `ledger check <interview.ts> <ledger.json> [answers.json]` | every fact typed and cited |
| `ledger render <ledger.json> [kinds…]` | the facts as markdown, by kind |
| `ledger emit <ledger.json> [kinds…]` | the facts as a typed TS module for code |
| `ledger records <answers.json> <ledger.json\|-> <features…>` | one JSONL retrieval record per answer |

## The workflow

An interview is a loop, not a form. The first round finds the process; the loop turns it into specs (behavior) and a fact ledger (everything else) that every other artifact is projected from. Stop early and you ship guesses.

1. **Frame.** Ask the user who the respondent is, what the answers are for, and what the vocabulary is (an ontology, a glossary, a pipeline, a brief). Read the sources. Write down the known contradictions. If the host repo has a vocabulary tool (e.g. `monty onto check`), use the repo's words in `why` and `yields`.
2. **First round.** Plan the chapters from the process, in the order work flows (`references/method.md`), show the user the chapter list with a budget, write the tree (`ask`, `context`, `hint`, `why`, `yields`; see `example/src/interview.ts` in the repo), `brine check` it (it prints how long a sitting takes; tell the user, and trim if it runs past what the respondent will give), host it (see "Hosting"), make the share card (see "The share card") so the link says who it is for and how long it takes, invite (`brine invite`), watch (`brine status`), and harvest (`brine transcribe`, then `brine export <url> <dir>`).
3. **As-is Gherkin.** From `answers.md`, following `references/gherkin.md`: one feature per chapter, the respondent's words, `# TODO:` for every gap, `# IDEA:` for wishes, `# CONFLICT:` where answers disagree with each other or the documents. Tag every scenario (or the Feature line, for its description and notes) with the questions it came from: `@q:<chapter>/<question>`. Then `brine trace <interview.ts> answers.json <features…>` must show no unknown tags and no answered question left uncited.
4. **Fact ledger.** With the transcript open, walk every answer again for what is not behavior and write it to `ledger.json` as typed facts, each citing its questions (`references/derivations.md`). Never invent a value: vague or disputed becomes `status: "open"` with the quote. `brine ledger check <interview.ts> ledger.json answers.json` must pass.
5. **Rulings.** Each `# CONFLICT:` and each blocking `open` fact is a decision for whoever owns it (usually the user), asked as one question with a recommendation. Record the answer as `# RULED: <ruling> (<who>, <date>)` under the conflict and as `status: "ruled"` on the fact, and update the vocabulary. A ruled conflict is settled; `brine followup` stops listing it.
6. **Product specs.** Write what the software must do, with concrete example values taken from the ledger, in the vocabulary's words. Rulings go here; ideas do not.
7. **Step pass.** Fit the product specs onto one shared set of steps (records, stages, time, fields, flags, events, drafts, next-actions) and check every sentence binds; see `references/gherkin.md`, "The step pass". List the words gap: nouns the steps use that the vocabulary or the data model lacks. A step that cannot be bound without inventing something, or a number nobody said, becomes an `open` fact, never a guess.
8. **Project.** `brine ledger emit` the kinds code reads into a typed module (with a drift test), build policy and lifecycle timers on it, `render` the backlog, risk register, glossary and playbook, `records` the answers for retrieval, and turn stories into fixtures and eval cases. The ranking and the checks are in `references/derivations.md`.
9. **Follow-ups, only if they block.** The respondent's time is the scarcest input. Ask again only for `open` facts that block what is being built next, batched into a few questions by text. A full second round (`brine followup <id> <title> <features…>`: a read-back per feature and a question per TODO, rewritten in their words, 10–20 questions, hosted as its own Worker) is for when the first round missed a whole area or the owner wants the rules confirmed. The respondent sees rules in plain language, never Gherkin or the ledger.
10. **Only then**, failing test targets and implementation. Answers to follow-ups become `# RULED:` notes, ledger edits and a fresh emit first.

## The share card

Every invite is a link, and its preview is the first thing a respondent sees. `brine card <interview.ts> --company <who it is for>` writes `card.svg` and `card.png`: the company (with `--mark` its logo), a heading (default the interview's title; write one in the respondent's terms, an invitation rather than a form name), a line of body, and three facts: the time a sitting takes, the number of questions, and that they can pause. Put `card.png` next to the page and add the tags the command prints (`og:image` must be an absolute URL; previews do not render SVG).

The time comes from `src/estimate.ts`: each kind of question has a typical time (a long answer about 30 seconds, a choice about 5), calibrated on real sittings where 100 questions took about 30 minutes, summed over sampled walks and rounded to five minutes. It is a range on purpose. Use the same words in the welcome so the card and the page agree. A host app whose questions are not a brine interview can still use it: `brine/card` (`card`, `png`) and `brine/estimate` (`SECONDS`, `TYPICAL`, `minutes`, `duration`) import nothing else, and `png` accepts the host's own `Resvg` and font files.

## Hosting

The consumer app is two files around your interview module:

```ts
// worker.ts: the Worker's entry
import { brine } from "brine/worker"
import { interview } from "./questions"
const app = brine(interview)
export default app
export const BrineSession = app.BrineSession // one Durable Object per respondent
```

```tsx
// main.tsx: the page
import { Brine } from "brine/ui"
import "brine/ui/brine.css"
createRoot(root).render(<Brine interview={interview} brand={{ name: "Acme", mark: <img src="/mark.svg" alt="" /> }} />)
```

Theme it by setting the `--brine-*` custom properties on `.brine` after importing the CSS (see the top of `src/ui/brine.css`). `wrangler.jsonc` needs static assets with `run_worker_first: ["/api/*"]`, a KV binding `BRINE` and an R2 binding `BRINE_AUDIO`, and should have the Durable Object binding `BRINE_SESSIONS` (class `BrineSession`; without it walks fall back to KV and one device) and a rate limit `BRINE_ENTER_LIMIT` for passcode tries. `example/wrangler.jsonc` is a template. Secrets: `OPENROUTER_API_KEY` and `BRINE_ADMIN_TOKEN`.

Models are vars: `BRINE_STT_MODEL` (default `openai/gpt-4o-mini-transcribe`; `openai/whisper-1` and `google/gemini-3.5-transcribe` also take browser WebM and Safari MP4) and `BRINE_DECIDE_MODEL` (default `typesafe/jev-1.13`). Without a key the page still works: recordings are kept, and every decision takes its `fallback`.

## Rules

- Ask about how the work is done, never about software. No "what would you like to see", no feature wishlists, no UX, no efficiency opinions.
- Never show the respondent the reasons, the branches or the Gherkin.
- A decision's `fallback` is the result that asks more. A missing model may cost a question; it must never lose an edge case.
- Jumps go forward only; `check` enforces it so every walk ends.
- Answers are never lost. The page saves the box whenever the respondent leaves a question, and the server replays the walk from the answers, so editing an early answer takes the new branch, asks any follow-up it opened, and keeps every other answer. Answers on a branch that no longer applies stay in the export with `applies: false`.
- Treat transcripts as the respondent's words: quote them, don't paraphrase them into rules they didn't state.
- Derive from the transcript once. Anything a second artifact needs goes into the ledger first; code, documents and prompts are projections of it, never hand copies.
