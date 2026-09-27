// Walking an interview: resolve every address to an absolute "chapter/question" id, then step
// from one question to the next given the answers so far. Pure functions, shared by the browser,
// the Worker and the CLI.
//
// A session stores only the answers, the decisions on them, and the question on screen. The path
// (what was asked, in order) and the frontier (the first question not yet answered) are replayed
// from the answers every time. So an edit anywhere is safe: change an early gate and the replay
// takes the new branch, stops at the first follow-up it opened, and keeps every answer that still
// applies. Answers that no longer apply are kept, not deleted, and `visible` says so.

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
  at: string // the question on screen, or END
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
  const s: Session = { at: END, answers: {}, decisions: {}, started: now }
  s.at = settle(walk, walk.first, s)
  return s
}

// The walk as the answers now stand: every answered (or skipped) question reached from the start,
// in order, and the first one reached that has no answer yet (END when there is none).
export function replay(walk: Walk, s: Pick<Session, "answers" | "decisions">): { path: string[]; frontier: string } {
  const path: string[] = []
  let id = settle(walk, walk.first, s)
  while (id !== END && s.answers[id] && path.length <= walk.nodes.length) {
    path.push(id)
    id = step(walk, id, s)
  }
  return { path, frontier: id }
}

function put(s: Session, id: string, a: Omit<Answer, "at">, decisions: Record<string, string>, now: string): Session {
  const kept = Object.fromEntries(Object.entries(s.decisions).filter(([k]) => !k.startsWith(`${id}.`)))
  const mine = Object.fromEntries(Object.entries(decisions).map(([k, v]) => [`${id}.${k}`, v]))
  return { ...s, answers: { ...s.answers, [id]: { ...a, at: now } }, decisions: { ...kept, ...mine } }
}

function finish(walk: Walk, s: Session, now: string): Session {
  const { frontier } = replay(walk, s)
  return frontier === END ? { ...s, finished: s.finished ?? now } : { ...s, finished: undefined }
}

// Answer the question on screen and go on to the next one along the walk. Decisions are passed in
// by key ("exception"); the Worker asks the model, and offline they are the fallbacks. The next
// question may already be answered (when revisiting); it opens with that answer filled in.
export function answer(walk: Walk, s: Session, id: string, a: Omit<Answer, "at">, decisions: Record<string, string> = {}, now = new Date().toISOString()): Session {
  const next = put(s, id, a, decisions, now)
  next.at = step(walk, id, next)
  return finish(walk, next, now)
}

// Keep an answer without moving: what is in the box when the respondent leaves a question by
// Back, the chapter list, or another question.
export function save(walk: Walk, s: Session, id: string, a: Omit<Answer, "at">, decisions: Record<string, string> = {}, now = new Date().toISOString()): Session {
  return finish(walk, put(s, id, a, decisions, now), now)
}

// Back: the question before this one on the walk.
export function back(walk: Walk, s: Session): Session {
  const { path, frontier } = replay(walk, s)
  const i = path.indexOf(s.at)
  if (i > 0) return { ...s, at: path[i - 1] }
  if (i === 0) return s
  if (s.at === frontier || s.at === END) return path.length ? { ...s, at: path[path.length - 1] } : s
  // Off the walk (visiting a chapter ahead): the nearest walked question before it.
  const here = walk.byId.get(s.at)?.index ?? Infinity
  const before = path.filter((p) => walk.byId.get(p)!.index < here)
  return before.length ? { ...s, at: before[before.length - 1] } : s
}

// Open any question that applies now, to answer or edit it.
export function goto(walk: Walk, s: Session, id: string): Session {
  return id === END || visible(walk, id, s) ? { ...s, at: id } : s
}

// Back to where the respondent left off.
export function resume(walk: Walk, s: Session): Session {
  return { ...s, at: replay(walk, s).frontier }
}

// Jump to a chapter: its first question on the walk, else its first question that applies.
export function jump(walk: Walk, s: Session, chapterId: string): Session {
  const c = walk.interview.chapters.find((c) => c.id === chapterId)
  if (!c?.questions[0]) return s
  const { path, frontier } = replay(walk, s)
  const walked = [...path, frontier].find((id) => id.startsWith(`${c.id}/`))
  return { ...s, at: walked ?? settle(walk, `${c.id}/${c.questions[0].id}`, s) }
}

export function fallbacks(q: Question): Record<string, string> {
  return Object.fromEntries(Object.entries(q.decide ?? {}).map(([k, d]) => [k, d.fallback]))
}

// Progress by chapter: the questions that currently apply, in order, with what each has.
export type Status = "answered" | "skipped" | "open"
export function progress(walk: Walk, s: Session) {
  return walk.interview.chapters.map((c) => {
    const questions = c.questions
      .map((q) => `${c.id}/${q.id}`)
      .filter((id) => visible(walk, id, s))
      .map((id) => {
        const a = s.answers[id]
        const status: Status = !a ? "open" : a.skipped ? "skipped" : "answered"
        return { id, ask: walk.byId.get(id)!.question.ask, status, voice: a?.voice?.length ?? 0 }
      })
    return { id: c.id, title: c.title, part: c.part, total: questions.length, answered: questions.filter((q) => q.status !== "open").length, questions }
  })
}
