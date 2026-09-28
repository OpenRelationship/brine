# From answers to Gherkin

Input: `answers.md` from `brine export` (and `answers.json` when you need the raw values). Output:
`.feature` files that describe how the respondent's process works, in their words, plus a list of
what is still open.

## Principles

- **Only what was said.** A step is either the respondent's statement or marked `# TODO:` with the
  question that would settle it. Never fill a gap with what the process "probably" does.
- **Their words.** Use the respondent's terms in step text. Where they said one word for two things,
  keep both meanings apart and note the collision at the top of the feature.
- **Transcripts are raw.** Speech rambles and corrects itself. Take the last version of a
  self-correction, drop fillers, keep numbers, names and conditions exactly.
- **Examples are evidence.** A story ("the Toyota store that…") becomes a Scenario or an Examples row,
  not a rule. A rule needs the respondent to have said it generally or shown it twice.
- **Jev's reads are hints.** A decision says which branch the walk took; it is not a finding.
- **Every scenario cites its answers.** Put `@q:<chapter>/<question>` tags on each scenario, and on the
  Feature line for answers its description or notes draw on. `brine trace` checks them.

## Shape

One feature per chapter of the process (per `yields`). Cross-cutting chapters (exceptions, money,
words) either become their own feature or add Rules and Scenarios to the step features they touch.

```gherkin
# Source: <interview title>, <respondent>, exported <date>. Answers quoted from their own words.
@<chapter-id>
Feature: Reaching dealers
  In order to get written numbers from three or four dealers
  As the salesperson
  I contact each dealer's internet manager with the exact car and ask for an out-the-door quote

  Background:
    Given a paid deal with confirmed search criteria

  Rule: first contact goes to the internet manager, never the floor

    Scenario: opening message to a new dealer
      Given a listing with a full VIN at a dealer I have not used
      When I text the internet manager "…their words…"
      Then I ask for the OTD price in writing, by email

    Scenario: a dealer goes quiet
      Given a dealer has not replied for 2 days
      When it is a store I use often
      Then I call the manager directly
      # TODO: what counts as a store used often? (asked: no number given)

  Scenario Outline: fees by state
    Given a dealer in <state>
    Then the doc fee is <treatment>
    Examples:
      | state | treatment              |
      | TX    | capped, not negotiable |
```

- **Feature** description (the `In order to / As / I want` lines) comes from the chapter's
  opening answers.
- **Background** holds what is true before every scenario in the feature.
- **Rule** for anything stated as always/never or shown with a threshold.
- **Scenario** per decision point, per exception the respondent named, per story told.
- **Scenario Outline + Examples** when answers list variants (fees by state, creators by terms).
- **Glossary**: a `words.feature` (or a comment block) with each term as the respondent defined it,
  flagged where it differs from the designer's vocabulary.

## Markers

Comments carry what is not yet a rule. `brine followup` reads them; indent a marker under the scenario
it belongs to, or at the feature's own indent for the feature as a whole.

| Marker | Means | Goes to |
| --- | --- | --- |
| `# TODO:` | the respondent did not say, or said it vaguely | an `open` fact in the ledger; a follow-up only if it blocks |
| `# IDEA:` | something they want but do not do | the backlog; never a rule |
| `# CONFLICT:` | two sources disagree | the owner, as one question with a recommendation |
| `# RULED:` | the owner's ruling, with who and when, right under its CONFLICT | settles it; the specs follow it |

## Two layers

The as-is features describe how the respondent works today, in their words. They are not a contract.
The product features describe what the software must do; they cite the as-is feature they come from,
carry the rulings, and use concrete example values. Keep them in separate folders.

## The step pass

Before any product feature becomes a test, fit it onto one shared set of steps and prove every
sentence binds. Prose Gherkin binds one sentence to one step: 400 sentences, 400 step bodies. A shared
set of 60–80 steps about records, stages, time, fields, flags, events, drafts and next-actions binds
them all, and the act of fitting finds the gaps:

- **The same thing said several ways** ("a deal in stage X", "the deal is in stage X") collapses to one step.
- **A value baked into the sentence** becomes a parameter; the word for the field, the command or the
  flag becomes a vocabulary word (check it; a word the vocabulary lacks is added, a ruled word replaced).
- **An unobservable Then** ("the client is told…", "the owner is warned…") becomes a draft, a flag, an
  event or a next-action someone can see. If none fits, it is a question, not a step.
- **A number nobody said** (a threshold, a milestone, a limit) is an `open` fact, asked only if it blocks.
- **A number somebody did say** is read from the ledger's emitted module, never typed into a step.

Measure it: sentences, steps used, sentences per step, unbound sentences (must be 0), and the words the
steps pass. Keep the step bodies pending until the respondent has read the rules back; a binding
check stays green meanwhile, and the failing targets come at the end of the loop.

## After writing

1. Run the host repo's Gherkin checker, if any (e.g. `just context feature check`).
2. List, for the user:
   - contradictions between answers, and between answers and the documents;
   - every `# TODO` as an `open` fact, and which of them block the next build (those are the
     follow-ups; a full second round only when a whole area is missing, `brine followup` drafts it);
   - words the respondent used that the vocabulary lacks, and vocabulary words they never used.
3. Do not ship the features as the contract until the respondent has read them back. Send them in
   plain language (a short document or a read-through call), not as Gherkin.
