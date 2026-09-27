# Designing a process interview

The respondent knows the process better than anyone and cannot describe it. Experts compress: they
give the rule and forget the ten exceptions that make it work. A questionnaire that asks for rules
gets rules. One that asks for the last time it happened gets the process, the exceptions, the words
and the people. Every choice below serves that.

## Goals first

Write down, before any question:

- **Who** answers, and what they will and won't sit through. One sitting holds about 40–60 answers;
  a deep process interview meant to be taken in several sittings can hold 150–220, when it is
  chaptered so a sitting ends at a chapter.
- **What the answers are for.** Here that is Gherkin: features, rules, scenarios, examples and a
  glossary. So every question must be able to land somewhere in a `.feature` file (its `yields`).
- **The vocabulary.** An ontology, a glossary or a pipeline diagram gives the chapters and the words
  to test. Each word the business uses should be probed at least once: is it said, does it mean what
  the documents say, where does it blur into another word.
- **The known contradictions.** Where the website, the documents and the owner disagree (a refund
  clock, a speed claim, a brand name), write a neutral question that settles it, and say so in
  `why`. Never tell the respondent which answer the documents gave.

## Chapters

One chapter per step of the process, in the order the work flows. Then the cross-cutting chapters:
when it goes wrong, the money, relationships, handing the work to someone new, and the words. Open
with the respondent's own story (how they started, what a good outcome is to them) and close with
"what did we not ask".

Inside a chapter, follow the work: what arrives and from whom, what they do first, the decision
points, what they hand on and to whom, what signals done, and then what goes wrong. End every
chapter on an exception probe.

## Question patterns

Ask for instances, not generalities:

| Instead of | Ask |
| --- | --- |
| How do you negotiate? | Once a dealer answers with a price, what's your next move? |
| What are the risks? | Tell me about a quote that looked great and turned out to be wrong. |
| What's your process for X? | Walk me through the last X, in order. |
| What are the rules? | When don't you do it that way? Tell me the case you're thinking of. |
| What should a new hire know? | What would a new person get wrong here? |
| What terms do you use? | What do you call the email a dealer sends with the numbers? |

- **The last time.** "Think of the last deal where…" beats "usually". Follow a vague answer with a
  request for one specific instance (a `vague` decision).
- **The exception.** After any "usually" answer, a follow-up that opens only when the answer names a
  special case (an `exception` decision) asks for that case.
- **The threshold.** "When do you give up on a lead?" hides a number. If the answer has no number,
  ask for it (a `threshold` decision, then a `number` question).
- **The other party.** Ask what the customer wants, what the supplier wants, and what each does
  when it goes wrong. Classify who caused a delay (a `choice` decision) and route to that party's
  follow-up.
- **Their words.** "Say it the way you'd text it." Verbatim scripts become step text.
- **Extremes.** "The strangest…", "the angriest…", "the longest…". The edge cases live there.
- **The apprentice.** "What would you never let a new person do without asking?" surfaces the rules
  the expert enforces without knowing them.

Use choice, multi, number and scale questions as gates: facts that decide which follow-ups apply
(buy or lease, ever ships a car, has ever refunded). Give a gate `note: true` when the qualifier
matters ("mostly, except…").

Never ask about software, screens, features, wishes or efficiency. Never use the designer's jargon
(Gherkin, edge case, workflow, ontology). Keep asks short, in the second person, in the respondent's
words.

## Jev decisions

`decide` runs Jev on the answer (typed text, note and transcripts together) and stores typed results
that later guards read. The Decisions API has three types:

- `noul`: yes/no with a probability; brine turns it into "yes" or "no" at `threshold` (0.5).
- `choice`: one key of `criteria`.
- `score`: an ordered list of criteria; the result is the index.

Four reusable decisions cover most interviews:

```ts
const exception: Decision = { type: "noul", instructions: "Does the answer describe an exception, special case or condition under which the usual way changes?", criteria: { true: "unless, except, sometimes, it depends, or a named special case", false: "one uniform way" }, fallback: "yes" }
const vague: Decision = { type: "noul", instructions: "Is the answer general, without a specific instance, name, date or number?", criteria: { true: "generalities only", false: "names a real instance" }, fallback: "yes" }
const threshold: Decision = { type: "noul", instructions: "Does the answer state a concrete number, time or limit?", criteria: { true: "states a number", false: "no number" }, fallback: "no" }
const culprit: Decision = { type: "choice", instructions: "Who does the answer say caused the problem?", criteria: { client: "…", supplier: "…", us: "…", unclear: "…" }, fallback: "unclear" }
```

Every decision must be read by at least one guard, and its `fallback` must be the result that asks
more questions. Keep `instructions` to one sentence; Jev answers narrow questions well and broad ones
poorly.

## Structure rules

- Prefer `when` guards to `next` jumps. Guards read like the reason a question is asked; jumps are
  for "No, never" answers that make the rest of a chapter moot.
- Guards look backwards only; jumps go forwards only. `brine check` enforces both, so every walk
  ends.
- Put a follow-up directly after the question it follows up.
- Each question's `why` names the process fact, rule, word or edge case it is after. Each `yields`
  names its Gherkin target: `Feature: … — Rule: …`, `Scenario: …`, `Example rows: …`, `Glossary`.

## Review with the user

Before deploying, show the user `brine outline` (or the chapter list with counts and five sample
questions per chapter) and ask what is missing. Their corrections are cheaper now than after the
respondent has answered.
