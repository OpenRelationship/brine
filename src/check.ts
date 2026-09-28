// The design check. An interview passes when every address resolves, every jump goes forward (so
// every walk ends), every guard looks back at a question that can already be answered, every
// branch value exists, and every question says why it is asked and what it yields.

import type { Condition, Decision, Interview, Question } from "./spec"
import { minutes, seconds } from "./estimate"
import { answer, begin, compile, END, fallbacks, replay, resolve, type Session, type Walk } from "./walk"

const KINDS = ["long", "text", "choice", "multi", "number", "scale"]

export interface Report {
  errors: string[]
  warnings: string[]
  stats: {
    chapters: number
    questions: number
    always: number // asked on every walk
    conditional: number
    decisions: number
    walks: { min: number; median: number; max: number } // sampled
    minutes: { min: number; median: number; max: number } // the same walks, timed by kind (estimate.ts)
    byChapter: { id: string; title: string; questions: number; conditional: number }[]
  }
}

// Values a question can produce for a guard or a decision to test.
function values(q: Question): string[] | null {
  if (q.kind === "choice" || q.kind === "multi") return (q.options ?? []).map((o) => o.value)
  if (q.kind === "scale") return (q.scale ?? []).map((_, i) => String(i))
  return null
}

function outcomes(d: Decision): string[] {
  if (d.type === "noul") return ["yes", "no"]
  if (d.type === "score") return (Array.isArray(d.criteria) ? d.criteria : Object.keys(d.criteria ?? {})).map((_, i) => String(i))
  return Array.isArray(d.criteria) ? d.criteria : Object.keys(d.criteria ?? {})
}

export function check(interview: Interview, samples = 400): Report {
  const errors: string[] = []
  const warnings: string[] = []
  const walk = compile(interview)
  const seenChapters = new Set<string>()

  for (const c of interview.chapters) {
    if (seenChapters.has(c.id)) errors.push(`chapter ${c.id}: duplicate id`)
    seenChapters.add(c.id)
    if (!c.questions.length) errors.push(`chapter ${c.id}: no questions`)
    const ids = new Set<string>()
    for (const q of c.questions) {
      const where = `${c.id}/${q.id}`
      if (ids.has(q.id)) errors.push(`${where}: duplicate id`)
      ids.add(q.id)
      if (!KINDS.includes(q.kind)) errors.push(`${where}: unknown kind ${q.kind}`)
      if (!q.ask?.trim()) errors.push(`${where}: no ask`)
      if (!q.why?.trim()) errors.push(`${where}: no why`)
      if (!q.yields?.trim()) errors.push(`${where}: no yields`)
      if ((q.kind === "choice" || q.kind === "multi") && !(q.options?.length! >= 2)) errors.push(`${where}: ${q.kind} needs two or more options`)
      if (q.kind === "scale" && !(q.scale?.length! >= 2)) errors.push(`${where}: scale needs two or more points`)
      const vals = q.options?.map((o) => o.value) ?? []
      if (new Set(vals).size !== vals.length) errors.push(`${where}: duplicate option values`)
      if (q.kind !== "choice" && q.options?.some((o) => o.next)) errors.push(`${where}: only choice options can jump`)
      const here = walk.byId.get(where)!.index
      const forward = (t: string, what: string) => {
        const abs = resolve(interview, c, t)
        if (abs === END) return
        const n = walk.byId.get(abs)
        if (!n) errors.push(`${where}: ${what} ${t} does not exist`)
        else if (n.index <= here) errors.push(`${where}: ${what} ${t} goes backwards`)
      }
      if (q.next) forward(q.next, "next")
      for (const o of q.options ?? []) if (o.next) forward(o.next, `option ${o.value} next`)
      for (const [k, d] of Object.entries(q.decide ?? {})) {
        if (!["noul", "choice", "score"].includes(d.type)) errors.push(`${where}: decision ${k} has unknown type ${d.type}`)
        if (!d.instructions?.trim()) errors.push(`${where}: decision ${k} has no instructions`)
        if (d.type !== "noul" && !(outcomes(d).length >= 2)) errors.push(`${where}: decision ${k} needs criteria`)
        if (!outcomes(d).includes(d.fallback)) errors.push(`${where}: decision ${k} fallback ${d.fallback} is not a possible result (${outcomes(d).join(", ")})`)
      }
      if (q.decide && q.kind !== "long" && !q.note) warnings.push(`${where}: decisions read free words; give it kind long or note: true`)
      guard(q.when, where, here, c)
    }
    guard(c.when, `chapter ${c.id}`, walk.byId.get(`${c.id}/${c.questions[0]?.id}`)?.index ?? 0, c)

    function guard(cond: Condition | undefined, where: string, here: number, chapter = c) {
      if (!cond) return
      if ("all" in cond) return cond.all.forEach((x) => guard(x, where, here, chapter))
      if ("any" in cond) return cond.any.forEach((x) => guard(x, where, here, chapter))
      if ("none" in cond) return cond.none.forEach((x) => guard(x, where, here, chapter))
      const abs = resolve(interview, chapter, cond.q)
      const n = walk.byId.get(abs)
      if (!n) return void errors.push(`${where}: guard looks at ${cond.q}, which does not exist`)
      if (n.index >= here) return void errors.push(`${where}: guard looks at ${cond.q}, which is not asked before it`)
      if ("decision" in cond) {
        const d = n.question.decide?.[cond.decision]
        if (!d) return void errors.push(`${where}: guard reads decision ${cond.decision} on ${cond.q}, which has none`)
        for (const v of [cond.is].flat()) if (!outcomes(d).includes(v)) errors.push(`${where}: decision ${cond.q}.${cond.decision} never results in ${v}`)
        return
      }
      if ("is" in cond || "not" in cond) {
        const vals = values(n.question)
        const want = [("is" in cond ? cond.is : cond.not)].flat()
        if (!vals) errors.push(`${where}: guard compares ${cond.q} (${n.question.kind}) to a value; use answered or atLeast`)
        else for (const v of want) if (!vals.includes(v)) errors.push(`${where}: ${cond.q} has no option ${v}`)
      }
      if ("atLeast" in cond && !["number", "scale"].includes(n.question.kind)) errors.push(`${where}: atLeast needs a number or scale question`)
    }
  }

  // Sample walks with random answers and random decisions: how long is a real sitting?
  const lengths: number[] = []
  const times: number[] = []
  if (!errors.length)
    for (let i = 0; i < samples; i++) {
      const path = replay(walk, sample(walk)).path
      lengths.push(path.length)
      times.push(minutes(seconds(path.map((id) => walk.byId.get(id)!.question.kind))))
    }
  lengths.sort((a, b) => a - b)
  times.sort((a, b) => a - b)
  const spread = (xs: number[]) => ({ min: xs[0] ?? 0, median: xs[Math.floor(xs.length / 2)] ?? 0, max: xs[xs.length - 1] ?? 0 })

  const conditional = (cid: string, q: Question) => Boolean(q.when || interview.chapters.find((c) => c.id === cid)!.when)
  const byChapter = interview.chapters.map((c) => ({ id: c.id, title: c.title, questions: c.questions.length, conditional: c.questions.filter((q) => conditional(c.id, q)).length }))
  const questions = walk.nodes.length
  const cond = byChapter.reduce((n, c) => n + c.conditional, 0)
  return {
    errors,
    warnings,
    stats: {
      chapters: interview.chapters.length,
      questions,
      always: questions - cond,
      conditional: cond,
      decisions: walk.nodes.reduce((n, x) => n + Object.keys(x.question.decide ?? {}).length, 0),
      walks: spread(lengths),
      minutes: spread(times),
      byChapter,
    },
  }
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export function sample(walk: Walk): Session {
  let s = begin(walk)
  for (let guardSteps = 0; s.at !== END && guardSteps < 10_000; guardSteps++) {
    const q = walk.byId.get(s.at)!.question
    const vals = values(q)
    const value =
      q.kind === "multi" ? vals!.filter(() => Math.random() < 0.4) : vals ? pick(vals) : q.kind === "number" ? Math.floor(Math.random() * 10) : "an answer"
    const decisions = Object.fromEntries(Object.entries(q.decide ?? {}).map(([k, d]) => [k, pick(outcomes(d))]))
    s = answer(walk, s, s.at, Math.random() < 0.05 ? { skipped: true } : { value }, Object.keys(decisions).length ? decisions : fallbacks(q))
  }
  return s
}
