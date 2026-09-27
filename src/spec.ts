// The shape of an interview. An interview is data: chapters of questions, walked in order, with
// guards (`when`) that skip what does not apply, jumps (`next`) that leave a question early, and
// decisions (`decide`) that a model reads off a free answer so later guards can branch on it.
//
// Two fields are for the designer, never shown to the respondent:
//   why     what the question is really trying to uncover (the indirect aim)
//   yields  where the answer lands in the Gherkin (a Feature, Rule, Scenario, step or example)

export type Kind =
  | "long" //   free answer; typed, spoken, or both
  | "text" //   one line
  | "choice" // pick one option
  | "multi" //  pick any options
  | "number" // a number, optionally with a unit
  | "scale" //  pick one point on an ordered scale

// A question address. Inside a chapter a bare id ("silence") means that chapter's question; a
// chapter id alone ("dealers") means its first question; "@end" ends the interview.
export type Target = string

export interface Option {
  value: string
  label: string
  // Leave the question for somewhere else when this option is chosen. Jumps only go forward.
  next?: Target
}

// A question the model answers about the respondent's answer. Branch on the result with
// `{ q, decision, is }`. Results are strings:
//   noul    "yes" or "no" (probability of yes against `threshold`, default 0.5)
//   choice  one key of `criteria`
//   score   the index of the chosen criterion, "0", "1", ...
export interface Decision {
  type: "noul" | "choice" | "score"
  instructions: string
  criteria?: Record<string, string> | string[]
  threshold?: number
  // Used when no model is configured or the call fails. Pick the result that asks MORE, so a
  // missing model costs a question, never a lost edge case.
  fallback: string
}

export type Condition =
  | { q: Target; is: string | string[] } //                 answer equals, or a multi answer includes, one of
  | { q: Target; not: string | string[] } //                the opposite
  | { q: Target; answered: boolean } //                     anything given (typed, spoken or chosen)
  | { q: Target; decision: string; is: string | string[] } // a model decision on that answer
  | { q: Target; atLeast: number } //                       number or scale answer >= n
  | { all: Condition[] }
  | { any: Condition[] }
  | { none: Condition[] }

export interface Question {
  id: string
  kind: Kind
  ask: string
  hint?: string
  options?: Option[] // choice, multi
  scale?: string[] //   scale: labels from low to high; the answer is the index as a string
  unit?: string //      number
  // Choice, multi, scale and number questions can also take a spoken or typed note.
  // Long questions always can.
  note?: boolean
  next?: Target
  when?: Condition
  decide?: Record<string, Decision>
  why: string
  yields: string
}

export interface Chapter {
  id: string
  title: string
  // The stretch of the process this chapter belongs to ("Before they pay"). Consecutive chapters
  // with the same part are grouped, so the respondent can see where they are in the whole.
  part?: string
  lede?: string // one or two sentences shown at the top of the chapter's first question
  when?: Condition
  questions: Question[]
}

export interface Interview {
  id: string
  title: string
  // Who the interview is for, in the respondent's own terms ("Ben"). Used in copy only.
  respondent?: string
  welcome: { heading: string; body: string }
  farewell: { heading: string; body: string }
  // Terms the respondent may see in questions. The designer's vocabulary, for the Gherkin pass.
  glossary?: Record<string, string>
  chapters: Chapter[]
}

export const END = "@end"
