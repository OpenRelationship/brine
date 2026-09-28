// The fact ledger: everything the respondent stated that is not a scenario, as typed facts, each
// citing the answers it came from. It is the one source the other artifacts are projected from:
//
//   number    a value with a unit (a fee, a percentage, a limit)          -> policy constants
//   timer     a duration after an event, and what happens then            -> lifecycle timers, next-actions
//   rule      a condition and its outcome, when a table says it best      -> decision tables
//   template  wording they use, with the fields that change               -> message drafts, agent voice
//   story     a real case they told, with its outcome                     -> fixtures, seed data, eval cases
//   signal    something they read as meaning something (a red flag)        -> agent knowledge, eval cases
//   term      a word of theirs and what they mean by it                   -> vocabulary
//   idea      something they want but do not do                           -> backlog
//   risk      something that could hurt: legal, money, trust              -> risk register
//   metric    something they watch or would judge by                      -> analytics events, dashboards
//
// A fact is `said` (in the answers), `ruled` (the owner decided it) or `open` (unclear or disputed;
// it needs a ruling or a question before anything is built on it).

import type { Interview } from "./spec"

export const KINDS = ["number", "timer", "rule", "template", "story", "signal", "term", "idea", "risk", "metric"] as const
export type FactKind = (typeof KINDS)[number]

export interface Fact {
  id: string // kebab-case, unique in the ledger
  kind: FactKind
  says: string // the fact in plain words
  sources: string[] // question ids, "<chapter>/<question>"; empty only for a ruling that came from outside the answers
  status: "said" | "ruled" | "open"
  ruling?: string // for ruled facts: the ruling, who and when
  quote?: string // the respondent's own words, verbatim from a transcript or typed answer
  tags?: string[] // the process step or domain it belongs to
  value?: number | string // number: the value; a range is "3-5"
  unit?: string // number and timer: percent, USD, minutes, hours, days, miles, deals/month, ...
  after?: string // timer: the event the clock runs from
  then?: string // timer: what happens when it runs out
  text?: string // template: the wording, with {field} placeholders
  when?: string // rule and signal: the condition
  outcome?: string // rule, story and signal: the result
  severity?: "high" | "medium" | "low" // risk
  mitigation?: string // risk: what would reduce it
}

export interface Ledger {
  interview: string // the interview's id
  respondent: string
  facts: Fact[]
}

export interface LedgerReport {
  errors: string[]
  warnings: string[]
  byKind: Record<string, number>
  byStatus: Record<string, number>
  uncited: string[] // answered questions no fact cites (only when answered ids are given)
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function checkLedger(ledger: Ledger, interview?: Interview, answered: string[] = []): LedgerReport {
  const errors: string[] = []
  const warnings: string[] = []
  const ids = interview ? new Set(interview.chapters.flatMap((c) => c.questions.map((q) => `${c.id}/${q.id}`))) : undefined
  const seen = new Set<string>()
  const cited = new Set<string>()
  const byKind: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  for (const f of ledger.facts) {
    const at = `${f.kind}/${f.id}`
    if (!ID.test(f.id)) errors.push(`${at}: id must be kebab-case`)
    if (seen.has(f.id)) errors.push(`${at}: duplicate id`)
    seen.add(f.id)
    if (!(KINDS as readonly string[]).includes(f.kind)) errors.push(`${at}: unknown kind`)
    if (!f.says?.trim()) errors.push(`${at}: says nothing`)
    if (!["said", "ruled", "open"].includes(f.status)) errors.push(`${at}: status must be said, ruled or open`)
    if (f.status === "ruled" && !f.ruling?.trim()) errors.push(`${at}: a ruled fact records its ruling`)
    if (f.status !== "ruled" && !f.sources?.length) errors.push(`${at}: cites no answer`)
    for (const s of f.sources ?? []) {
      cited.add(s)
      if (ids && !ids.has(s)) errors.push(`${at}: cites ${s}, which is not a question`)
    }
    if (f.kind === "number" && (f.value === undefined || !f.unit)) errors.push(`${at}: a number has a value and a unit`)
    if (f.kind === "timer" && (f.value === undefined || !f.unit || !f.after || !f.then)) errors.push(`${at}: a timer has a value, a unit, after and then`)
    if (f.kind === "template" && !f.text?.trim()) errors.push(`${at}: a template has text`)
    if ((f.kind === "rule" || f.kind === "signal") && (!f.when || !f.outcome)) errors.push(`${at}: a ${f.kind} has when and outcome`)
    if (f.kind === "story" && !f.outcome) warnings.push(`${at}: a story without an outcome is hard to test against`)
    if (f.kind === "risk" && !f.severity) errors.push(`${at}: a risk has a severity`)
    if (f.kind === "risk" && !f.mitigation) warnings.push(`${at}: a risk without a mitigation`)
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
    byStatus[f.status] = (byStatus[f.status] ?? 0) + 1
  }
  return { errors, warnings, byKind, byStatus, uncited: answered.filter((a) => !cited.has(a)) }
}

// Look a fact up by id, for code that reads its constants from the ledger.
export function fact(ledger: Ledger, id: string): Fact {
  const f = ledger.facts.find((x) => x.id === id)
  if (!f) throw new Error(`no fact ${id} in the ${ledger.interview} ledger`)
  return f
}

const TITLES: Record<FactKind, string> = {
  number: "Numbers",
  timer: "Timers",
  rule: "Rules",
  template: "Their words",
  story: "Stories",
  signal: "Signals",
  term: "Terms",
  idea: "Ideas (backlog)",
  risk: "Risks",
  metric: "Metrics",
}

// The ledger as plain markdown, one section per kind (or only the kinds asked for): what the
// people who do not read code get, and what an agent can be handed as knowledge.
export function renderLedger(ledger: Ledger, kinds: FactKind[] = [...KINDS]): string {
  const out = [`# ${ledger.respondent}: ${kinds.length === 1 ? TITLES[kinds[0]] : "what they told us"}`, ""]
  for (const k of kinds) {
    const fs = ledger.facts.filter((f) => f.kind === k)
    if (!fs.length) continue
    if (kinds.length > 1) out.push(`## ${TITLES[k]}`, "")
    const order = k === "risk" ? (f: Fact) => ["high", "medium", "low"].indexOf(f.severity ?? "low") : () => 0
    for (const f of [...fs].sort((a, b) => order(a) - order(b))) {
      const head = [
        f.kind === "number" || f.kind === "timer" ? `**${f.value} ${f.unit}**` : "",
        f.kind === "risk" ? `**${f.severity}**` : "",
        f.says,
        f.status === "open" ? "_(open)_" : f.status === "ruled" ? `_(ruled: ${f.ruling})_` : "",
      ].filter(Boolean)
      out.push(`- ${head.join(" ")} \`${f.id}\``)
      if (f.after) out.push(`  - runs from ${f.after}; then ${f.then}`)
      if (f.when) out.push(`  - when ${f.when}: ${f.outcome}`)
      else if (f.outcome) out.push(`  - outcome: ${f.outcome}`)
      if (f.text) out.push(`  - "${f.text}"`)
      if (f.quote) out.push(`  - > ${f.quote}`)
      if (f.mitigation) out.push(`  - mitigation: ${f.mitigation}`)
      if (f.sources.length) out.push(`  - from ${f.sources.join(", ")}`)
    }
    out.push("")
  }
  return out.join("\n")
}

// The ledger as a TypeScript module for code to import: every fact keyed by id, as const, so a
// constant, a timer or a template is read by name and a typo is a type error. Regenerate it after
// every ledger edit; a test that compares it with a fresh emit catches drift.
export function emitLedger(ledger: Ledger, from: string, kinds: FactKind[] = [...KINDS]): string {
  const facts = Object.fromEntries(ledger.facts.filter((f) => kinds.includes(f.kind)).map((f) => [f.id, f]))
  return [
    `// GENERATED by \`brine ledger emit\` from ${from}. Do not edit; change the ledger and emit again.`,
    `export const LEDGER = ${JSON.stringify({ interview: ledger.interview, respondent: ledger.respondent })} as const`,
    "",
    `export const FACTS = ${JSON.stringify(facts, null, 2)} as const`,
    "",
    "export type FactId = keyof typeof FACTS",
    "",
  ].join("\n")
}
