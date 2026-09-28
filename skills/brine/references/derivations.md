# Derivations: what else the answers become

Gherkin captures behavior: who does what, in what order, and what happens when it goes wrong. An interview also contains numbers, clocks, wording, real cases, red flags, words, wishes, worries and the things the respondent watches. Those don't fit a scenario. If they are left in the transcript, each builder mines them again in their own way and gets a slightly different answer.

The fix is one intermediate store, **the fact ledger**. Every other artifact is a projection of it. Write the ledger once, check it, and then project from it, rather than deriving each artifact from the transcript separately.

```
answers.json ──► as-is Gherkin (behavior) ──► product specs ──► step pass ──► failing targets
      │                                                              │
      └────────► ledger.json (facts) ──┬─ emit ──► typed module ─────┘ (code reads constants by id)
                                       ├─ render ─► markdown by kind (backlog, risks, playbook, glossary)
                                       └─ records ► one retrieval record per answer
```

## The ledger

`ledger.json` is `{ interview, respondent, facts[] }`. The schema is in `src/ledger.ts`. Every fact has:

- an `id` in kebab-case;
- a `kind`;
- `says`, the fact in plain words;
- `sources`, the question ids it came from;
- a `status`:
  - `said`: it appears in the answers.
  - `ruled`: the owner decided it, and `ruling` records who and when.
  - `open`: it is unclear or disputed, so nothing is built on it yet.

Put `quote` on anything someone might later dispute.

| Kind | Holds | Required fields | Becomes |
| --- | --- | --- | --- |
| `number` | a fee, a percentage, a limit, a threshold | `value`, `unit` | policy constants, decision thresholds |
| `timer` | a duration after an event, and what happens then | `value`, `unit`, `after`, `then` | lifecycle clocks, due next-actions, reminders |
| `rule` | a condition and its outcome, when a table says it best | `when`, `outcome` | decision tables, validation |
| `template` | wording they use, with `{field}` placeholders | `text` | message drafts, the voice of any agent |
| `story` | a real case they told, with its outcome | `outcome` | fixtures, demo seed, eval cases |
| `signal` | something they read as meaning something | `when`, `outcome` | agent knowledge, triage flags, eval cases |
| `term` | a word of theirs and what they mean by it | — | the vocabulary (glossary or ontology) |
| `idea` | something they want but don't do today | — | backlog, never a spec |
| `risk` | something that could hurt: legal, money, trust, key person | `severity` (+ `mitigation`) | risk register |
| `metric` | something they watch or would judge success by | — | analytics events, dashboards |

Write the ledger after the as-is Gherkin, with the transcript open. Walk each answer and ask what in it is not behavior. A single answer often gives both a scenario and several facts.

1. Never invent a value. If they said "a couple of days", record the fact as `open` with the quote, and ask about it or ask for a ruling.
2. A range is a string (`"3-5"`), not the midpoint.
3. If two answers disagree, record one `open` fact that cites both and add a `# CONFLICT:` in the Gherkin. A ruling flips the fact to `ruled`.

`brine ledger check <interview.ts> ledger.json answers.json` checks the ledger. It fails on bad ids, a missing required field, or a citation that isn't a question. It also lists answered questions that no fact cites; that is fine when a scenario covers them.

## The projections, ranked

The projections are ranked by value per effort, most first. All of them are generic: they depend on the ledger's shape, not on the domain.

### 1. Constants and timers as data (`brine ledger emit`)

**What it is.** Emit the ledger as a typed module and have code read `FACTS["cutoff"].value` instead of a literal. Emit only the kinds code reads, usually `number timer rule template signal metric story`.

**How it's kept honest.** A test compares the checked-in module with a fresh emit, so the module can't drift from the ledger. A second test asserts that each policy function returns what the facts say.

**Why it ranks first.** Every number someone said has exactly one home. A changed answer or a new ruling updates the code in one step, and a typo in a fact id is a type error.

**Timers go further.** Each `timer` (`value`, `unit`, `after`, `then`) is a clock. A lifecycle module keeps a list of timer ids and a pure `due(clocks, now)` that returns what has run out. That one function drives reminders, next-actions and SLA flags. Test it at the boundary: one second before a clock runs out it is not due, and at the exact time it is.

### 2. Rendered markdown by kind (`brine ledger render <ledger> [kinds…]`)

**What it is.** Four documents, rendered from the ledger without any extra writing:

- `idea` → the backlog;
- `risk` → the risk register, sorted by severity;
- `term` → the glossary;
- `number timer rule template signal` → the operating playbook, i.e. how they work, for a new hire.

**Where the output goes.** Store it wherever the host repo keeps non-code knowledge. Don't hand-edit a render; edit the ledger and render again.

### 3. Retrieval records (`brine ledger records answers.json ledger.json features…`)

**What it is.** JSONL with one record per live answer. Each record has the question, the respondent's words (value, note and transcripts), and every scenario and fact that cites the answer.

**What it's for.** Load the records into whatever search the team uses. "What did they say about refunds?" then returns the words plus where they went.

**The gap check.** The stderr line counts answers that no scenario or fact cites. That count should be zero before specs are called done.

### 4. Templates as drafts

**What it is.** A `template` fact is the respondent's wording with `{field}` placeholders. `fill(id, fields)` produces a draft.

**The one rule.** A missing field throws. It never prints a blank.

**Why it matters.** It's the cheapest way to make generated messages sound like the business and not like a model. The same text becomes the fixed part of any agent prompt that writes in their voice.

### 5. Stories as fixtures and eval cases

**Fixtures.** Each `story` becomes a typed fixture: the records and timestamps the story implies, and its outcome.

**Tests.** Test the fixtures against the policy. The story's outcome must be what the rules compute. If it isn't, the rules are wrong or the story was an exception, and either way that is a question to ask.

**Seed data.** The same fixtures seed a demo, so the demo shows real cases instead of made-up ones.

**Evals.** Stories and signals become eval cases. Split them into two checks:

- `check: "rule"` cases are decided by code and run now.
- `check: "model"` cases need the agent and run once it exists. Until then, only check that each case is well formed and cites facts that exist.

### 6. Agent briefs from signals

**What it is.** Each agent the product will have gets a list of fact ids. `brief(agent)` renders the brief from them: its job, the limits every agent shares, and the respondent's facts for that job, in plain lines.

**Why it's cheap.** The brief is a projection, so it stays current with the ledger.

**What to test.**

- Every id an agent lists exists.
- Every brief carries the shared limits, for example: drafts only, never sends, never promises.

### 7. The words gap (from the step pass)

**What it is.** After the step pass, list every noun the product specs and steps use and check each one against the vocabulary and the data model. Three results:

- **Missing entirely.** The word is a vocabulary addition.
- **In the vocabulary but not in the schema.** The word is a data-model gap: a table, a column or a state to add.
- **In the schema under another name.** The word is a rename or a ruling.

**What it produces.** A short list that feeds the next migration. It is not a document to maintain.

### 8. Metrics as events and measures

**What it is.** Each `metric` fact names something to measure. Map it to the events the product must record and to a measure, such as the median gap between two events or the rate from one event to another, with the cuts the respondent asked for.

**What to test.** Every metric has a measure and every measure cites a metric.

**Why it ranks last.** It's worth doing, but only once the product records events. Before that it's a list of analytics events to add, not code.

## What to skip

- **A separate "rules" document next to the ledger.** It duplicates the ledger and then drifts from it. Render it instead.
- **A second interview to fill ordinary gaps.** Record the gap as an `open` fact. Ask only when a missing value blocks something you are about to build, and batch those questions into a short text, not a new round.
- **Deriving from the transcript twice.** If a second consumer needs something from the answers, it goes into the ledger first.
- **Hand-built demo data when stories exist.** Seed from the story fixtures.

## Checks, all cheap

| Check | Fails when |
| --- | --- |
| `brine trace` | a `@q:` tag names no question; an answered question has no scenario (listed) |
| `brine ledger check` | a fact is malformed or cites no question |
| emit drift test | the typed module differs from a fresh emit |
| policy tests | a function disagrees with the fact it reads |
| fixture tests | a story's outcome disagrees with the rules |
| brief / eval / measure tests | an id they cite does not exist |
| `brine ledger records` (stderr) | an answer is cited by no scenario and no fact |
