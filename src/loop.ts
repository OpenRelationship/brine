// The loop after the first interview: trace the as-is Gherkin back to the answers, then draft the
// second round from what is still open.
//
//   scan      reads a .feature file: its rules, its scenarios with their @q: source tags, and the
//             # TODO / # IDEA / # CONFLICT / # RULED markers under each (RULED is a settled CONFLICT:
//             the ruling, who made it and when, kept where the disagreement was)
//   trace     checks every @q: tag names a question, and lists answers no scenario cites
//   followup  drafts round two: one read-back per feature (the rules, in plain words, to confirm)
//             and one question per TODO. The designer rewrites the drafts in the respondent's words
//             before sending; CONFLICTs are rulings for the owner, not questions, so they are listed.

import type { Chapter, Interview, Question } from "./spec"

export type Marker = "TODO" | "IDEA" | "CONFLICT" | "RULED"

export interface Note {
  marker: Marker
  text: string
  line: number
}

export interface Scenario {
  name: string
  line: number
  rule?: string
  sources: string[] // question ids from @q: tags
  notes: Note[]
}

export interface Scan {
  path: string
  feature: string
  sources: string[] // @q: tags on the Feature line: answers its description and notes draw on
  rules: string[]
  scenarios: Scenario[]
  notes: Note[] // markers outside any scenario
}

const MARK = /^#\s*(TODO|IDEA|CONFLICT|RULED):\s*(.*)$/

export function scan(text: string, path = ""): Scan {
  const out: Scan = { path, feature: "", sources: [], rules: [], scenarios: [], notes: [] }
  const sources = (t: string[]) => t.filter((x) => x.startsWith("@q:")).map((x) => x.slice(3))
  let tags: string[] = []
  let rule: string | undefined
  let current: Scenario | undefined
  let depth = 0 // the current scenario keyword's indent: a marker no deeper belongs to the feature
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    const n = i + 1
    const indent = raw.length - raw.trimStart().length
    const mark = line.match(MARK)
    if (mark) {
      const note = { marker: mark[1] as Marker, text: mark[2].trim(), line: n }
      ;(current && indent > depth ? current.notes : out.notes).push(note)
      return
    }
    if (line.startsWith("@")) {
      tags = tags.concat(line.split(/\s+/).filter((t) => t.startsWith("@")))
      return
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^Feature:\s*(.*)$/))) {
      out.feature = m[1].trim()
      out.sources = sources(tags)
      tags = []
    } else if ((m = line.match(/^Rule:\s*(.*)$/))) {
      rule = m[1].trim()
      out.rules.push(rule)
      current = undefined
      tags = []
    } else if ((m = line.match(/^Scenario(?: Outline)?:\s*(.*)$/))) {
      current = { name: m[1].trim(), line: n, rule, sources: sources(tags), notes: [] }
      depth = indent
      out.scenarios.push(current)
      tags = []
    } else if (/^Background:/.test(line)) {
      current = undefined
      tags = []
    }
  })
  return out
}

export interface Trace {
  cited: Record<string, string[]> // question id -> "path: scenario"
  unknown: { path: string; line: number; id: string }[]
  untagged: { path: string; line: number; name: string }[]
  uncited: string[] // answered questions no scenario cites
}

export function trace(interview: Interview, scans: Scan[], answered: string[] = []): Trace {
  const ids = new Set(interview.chapters.flatMap((c) => c.questions.map((q) => `${c.id}/${q.id}`)))
  const t: Trace = { cited: {}, unknown: [], untagged: [], uncited: [] }
  const cite = (path: string, line: number, where: string, id: string) => {
    if (!ids.has(id)) t.unknown.push({ path, line, id })
    else (t.cited[id] ??= []).push(`${path}: ${where}`)
  }
  for (const s of scans) {
    for (const id of s.sources) cite(s.path, 1, "Feature", id)
    for (const sc of s.scenarios) {
      if (!sc.sources.length) t.untagged.push({ path: s.path, line: sc.line, name: sc.name })
      for (const id of sc.sources) cite(s.path, sc.line, sc.name, id)
    }
  }
  t.uncited = answered.filter((id) => !t.cited[id])
  return t
}

export interface Followup {
  interview: Interview
  conflicts: { path: string; line: number; text: string }[]
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "part"

// A draft of round two. Each feature becomes a chapter: first the read-back (its rules as a list
// under one "Is this how it works?"), then one long question per TODO in it.
export function followup(scans: Scan[], meta: { id: string; title: string; respondent?: string }): Followup {
  const conflicts: Followup["conflicts"] = []
  const chapters: Chapter[] = []
  const seen = new Set<string>()
  for (const s of scans) {
    let id = slug(s.feature || s.path)
    while (seen.has(id)) id += "-2"
    seen.add(id)
    const questions: Question[] = []
    if (s.rules.length)
      questions.push({
        id: "readback",
        kind: "choice",
        ask: "Is this how it works?",
        context: s.rules,
        options: [
          { value: "yes", label: "Yes, that's right" },
          { value: "mostly", label: "Mostly; one thing is off" },
          { value: "no", label: "No, it works differently" },
        ],
        note: true,
        why: `Read-back of ${s.path}: the respondent confirms or corrects every rule before it becomes a spec.`,
        yields: `${s.path} — Rules confirmed or corrected`,
      })
    const all = [...s.notes.map((n) => ({ n, sc: undefined as Scenario | undefined })), ...s.scenarios.flatMap((sc) => sc.notes.map((n) => ({ n, sc })))]
    let k = 0
    all.sort((a, b) => a.n.line - b.n.line)
    for (const [i, { n, sc }] of all.entries()) {
      // A CONFLICT with a RULED right after it, in the same place, is settled.
      const ruled = all[i + 1]?.n.marker === "RULED" && all[i + 1].sc === sc
      if (n.marker === "CONFLICT" && !ruled) conflicts.push({ path: s.path, line: n.line, text: n.text })
      if (n.marker !== "TODO") continue
      questions.push({
        id: `gap-${++k}`,
        kind: "long",
        ask: n.text,
        context: sc ? `${s.feature}: ${sc.name}.` : `${s.feature}.`,
        why: `TODO at ${s.path}:${n.line}${sc?.sources.length ? ` (from ${sc.sources.join(", ")})` : ""}.`,
        yields: `${s.path}${sc ? ` — Scenario: ${sc.name}` : ""}`,
      })
    }
    if (questions.length) chapters.push({ id, title: s.feature || id, questions })
  }
  return {
    interview: {
      id: meta.id,
      title: meta.title,
      respondent: meta.respondent,
      welcome: { heading: meta.title, body: "A short follow-up. First, how we understood your answers: tell us what's right and what's off. Then a handful of things we still need." },
      farewell: { heading: "That's everything", body: "Thank you." },
      chapters,
    },
    conflicts,
  }
}

// The draft as a TypeScript module the designer edits.
export function source(interview: Interview): string {
  return `// Drafted by \`brine followup\`. Rewrite every ask in the respondent's words, cut to 10–20\n// questions, give each a context and hints, then \`brine check\` it.\nimport type { Interview } from "brine/spec"\n\nexport const interview: Interview = ${JSON.stringify(interview, null, 2)}\n`
}
