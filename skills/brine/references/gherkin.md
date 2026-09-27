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

## Shape

One feature per chapter of the process (per `yields`). Cross-cutting chapters (exceptions, money,
words) either become their own feature or add Rules and Scenarios to the step features they touch.

```gherkin
# Source: <interview title>, <respondent>, exported <date>. Answers quoted from their own words.
@<chapter-id>
Feature: Taking wholesale orders
  In order to bake the right amount for every café account
  As the counter lead
  I confirm each café's standing order with the person who places it and log changes by noon

  Background:
    Given a café account with a standing weekly order

  Rule: changes come from the account's buyer, never from whoever answers the phone

    Scenario: a new café's first order
      Given a café we have not baked for before
      When the buyer emails "…their words…"
      Then I confirm quantities and delivery time in writing, by email

    Scenario: a standing order goes quiet
      Given an account has not confirmed for 2 days
      When it is an account we deliver to often
      Then I call the buyer directly
      # TODO: what counts as an account we deliver to often? (asked: no number given)

  Scenario Outline: delivery fees by zone
    Given a café in <zone>
    Then the delivery fee is <treatment>
    Examples:
      | zone  | treatment              |
      | north | flat, not negotiable   |
```

- **Feature** description (the `In order to / As / I want` lines) comes from the chapter's
  opening answers.
- **Background** holds what is true before every scenario in the feature.
- **Rule** for anything stated as always/never or shown with a threshold.
- **Scenario** per decision point, per exception the respondent named, per story told.
- **Scenario Outline + Examples** when answers list variants (fees by zone, accounts by size).
- **Glossary**: a `words.feature` (or a comment block) with each term as the respondent defined it,
  flagged where it differs from the designer's vocabulary.

## After writing

1. Run the host repo's Gherkin checker, if any (e.g. `just context feature check`).
2. List, for the user:
   - contradictions between answers, and between answers and the documents;
   - every `# TODO`, grouped into a short follow-up interview (10–20 questions, same method);
   - words the respondent used that the vocabulary lacks, and vocabulary words they never used.
3. Do not ship the features as the contract until the respondent has read them back. Send them in
   plain language (a short document or a read-through call), not as Gherkin.
