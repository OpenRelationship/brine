// Walking an interview: resolve every address to an absolute "chapter/question" id, then step
// from one question to the next given the answers so far. Pure functions, shared by the browser,
// the Worker and the CLI.

import { END, type Chapter, type Condition, type Interview, type Question, type Target } from "./spec"

export { END }

export interface Answer {
  value?: string | string[] | number // the choice, the picks, the number, or typed text
  note?: string //                      typed text beside a choice/number, or on a long answer
  voice?: string[] //                   recording ids, in the order they were made
  skipped?: boolean
  at: string //                         ISO time of the last change
}

export interface Session {
  at: string // the question being asked, or END
  path: string[] // the questions asked before it, oldest first, for Back
  answers: Record<string, Answer>
  decisions: Record<string, string> // "chapter/question.key" -> result
  started: string
  finished?: string
}

export interface Node {
  id: string // "chapter/question"
  index: number
  chapter: Chapter
  question: Question
}

export interface Walk {
  interview: Interview
  nodes: Node[]
  byId: Map<string, Node>
  first: string
}

// Absolute id for an address written inside `chapter`.
export function resolve(interview: Interview, chapter: Chapter, target: Target): string {
  if (target === END) return END
  if (target.includes("/")) return target
  if (chapter.questions.some((q) => q.id === target)) return `${chapter.id}/${target}`
  const other = interview.chapters.find((c) => c.id === target)
  if (other?.questions[0]) return `${other.id}/${other.questions[0].id}`
  return `${chapter.id}/${target}` // unresolvable; check() reports it
}

export function compile(interview: Interview): Walk {
  const nodes: Node[] = []
  for (const chapter of interview.chapters)
    for (const question of chapter.questions) nodes.push({ id: `${chapter.id}/${question.id}`, index: nodes.length, chapter, question })
  return { interview, nodes, byId: new Map(nodes.map((n) => [n.id, n])), first: nodes[0]?.id ?? END }
}

export function given(a: Answer | undefined): boolean {
  if (!a || a.skipped) return false
  const v = a.value
  const has = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== ""
  return has || Boolean(a.note?.trim()) || Boolean(a.voice?.length)
}

const list = (x: string | string[]) => (Array.isArray(x) ? x : [x])

export function holds(walk: Walk, chapter: Chapter, c: Condition | undefined, s: Pick<Session, "answers" | "decisions">): boolean {
  if (!c) return true
  if ("all" in c) return c.all.every((x) => holds(walk, chapter, x, s))
  if ("any" in c) return c.any.some((x) => holds(walk, chapter, x, s))
  if ("none" in c) return !c.none.some((x) => holds(walk, chapter, x, s))
  const id = resolve(walk.interview, chapter, c.q)
  const a = s.answers[id]
  if ("answered" in c) return given(a) === c.answered
  if ("decision" in c) {
    const d = s.decisions[`${id}.${c.decision}`]
    return d !== undefined && list(c.is).includes(d)
  }
  if ("atLeast" in c) return a?.value !== undefined && !a.skipped && Number(a.value) >= c.atLeast
  const v = a?.skipped ? undefined : a?.value
  const vals = Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]
  const hit = vals.some((x) => list("is" in c ? c.is : c.not).includes(x))
  return "is" in c ? hit : !hit
}

export function visible(walk: Walk, id: string, s: Pick<Session, "answers" | "decisions">): boolean {
  const n = walk.byId.get(id)
  return Boolean(n) && holds(walk, n!.chapter, n!.chapter.when, s) && holds(walk, n!.chapter, n!.question.when, s)
}

// The first visible question at or after `id` in reading order.
export function settle(walk: Walk, id: string, s: Pick<Session, "answers" | "decisions">): string {
  if (id === END) return END
  const start = walk.byId.get(id)?.index
  if (start === undefined) return END
  for (let i = start; i < walk.nodes.length; i++) if (visible(walk, walk.nodes[i].id, s)) return walk.nodes[i].id
  return END
}

// Where to go after answering `id`. The answer (and any decisions on it) must already be in `s`.
export function step(walk: Walk, id: string, s: Pick<Session, "answers" | "decisions">): string {
  const n = walk.byId.get(id)
  if (!n) return END
  const a = s.answers[id]
  const q = n.question
  let target: string | undefined
  if (q.kind === "choice" && a && !a.skipped && q.options) {
    const o = q.options.find((o) => o.value === a.value)
    if (o?.next) target = resolve(walk.interview, n.chapter, o.next)
  }
  if (!target && q.next) target = resolve(walk.interview, n.chapter, q.next)
  if (!target) target = walk.nodes[n.index + 1]?.id ?? END
  return settle(walk, target, s)
}

export function begin(walk: Walk, now = new Date().toISOString()): Session {
  const s: Session = { at: END, path: [], answers: {}, decisions: {}, started: now }
  s.at = settle(walk, walk.first, s)
  return s
}

// Record an answer and move on. Decisions for this question are passed in by key ("exception") (the Worker asks the
// model; offline they are the fallbacks). Answers further along that no longer apply are kept:
// if the respondent comes back to them, their earlier words are still there.
export function answer(walk: Walk, s: Session, id: string, a: Omit<Answer, "at">, decisions: Record<string, string> = {}, now = new Date().toISOString()): Session {
  const answers = { ...s.answers, [id]: { ...a, at: now } }
  const kept = Object.fromEntries(Object.entries(s.decisions).filter(([k]) => !k.startsWith(`${id}.`)))
  const mine = Object.fromEntries(Object.entries(decisions).map(([k, v]) => [`${id}.${k}`, v]))
  const next: Session = { ...s, answers, decisions: { ...kept, ...mine } }
  next.path = [...s.path, id]
  next.at = step(walk, id, next)
  if (next.at === END && !next.finished) next.finished = now
  return next
}

export function back(s: Session): Session {
  if (!s.path.length) return s
  return { ...s, at: s.path[s.path.length - 1], path: s.path.slice(0, -1) }
}

// Jump to a chapter: its first visible question, or the chapter after it if none apply.
export function jump(walk: Walk, s: Session, chapterId: string): Session {
  const c = walk.interview.chapters.find((c) => c.id === chapterId)
  if (!c?.questions[0]) return s
  const to = settle(walk, `${c.id}/${c.questions[0].id}`, s)
  if (to === s.at) return s
  return { ...s, at: to, path: s.at === END ? s.path : [...s.path, s.at] }
}

export function fallbacks(q: Question): Record<string, string> {
  return Object.fromEntries(Object.entries(q.decide ?? {}).map(([k, d]) => [k, d.fallback]))
}

// Progress by chapter: questions that currently apply, and how many of those are answered.
export function progress(walk: Walk, s: Session) {
  return walk.interview.chapters.map((c) => {
    const ids = c.questions.map((q) => `${c.id}/${q.id}`).filter((id) => visible(walk, id, s))
    return { id: c.id, title: c.title, part: c.part, total: ids.length, answered: ids.filter((id) => s.answers[id]).length }
  })
}
