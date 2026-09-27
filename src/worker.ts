// The server half. A Cloudflare Worker that keeps each respondent's walk, stores their
// recordings, transcribes them with a speech-to-text model, and asks Jev to read free answers so
// the walk can branch on what was said. No dependencies; mount it as the Worker's fetch handler:
//
//   import { brine } from "brine/worker"
//   import { interview } from "./questions"
//   export default brine(interview)
//
// Bindings (wrangler.jsonc):
//   BRINE          KV namespace: invites, sessions, recording records, transcripts
//   BRINE_AUDIO    R2 bucket: the recordings themselves
// Secrets:
//   OPENROUTER_API_KEY   transcription and decisions (without it: no transcripts, fallback branches)
//   BRINE_ADMIN_TOKEN    invites and export
// Vars (optional):
//   BRINE_STT_MODEL      default openai/gpt-4o-mini-transcribe
//   BRINE_DECIDE_MODEL   default typesafe/jev-1.13
//
// Routes. The respondent's bearer token is their invite code.
//   GET  /api/session            the respondent and their walk (starts one on first visit)
//   POST /api/answer             { q, value?, note?, voice?, skipped? } -> the walk, moved on
//   POST /api/back               -> the walk, one question back
//   POST /api/jump               { chapter } -> the walk, at that chapter
//   POST /api/voice?q=<id>       raw audio body -> { id, seconds }
//   DELETE /api/voice/<id>       drop a recording from an answer draft
// Admin (bearer BRINE_ADMIN_TOKEN):
//   POST /api/admin/invite       { name } -> { code }
//   GET  /api/admin/invites      every invite with progress
//   GET  /api/admin/export       every respondent, every asked question, with why, yields, answer, transcripts, decisions
//   GET  /api/admin/audio/<id>   one recording
//   POST /api/admin/transcribe   { id? } -> re-run transcription for one or every recording missing a transcript

import type { Interview } from "./spec"
import { answer, back, begin, compile, END, fallbacks, jump, progress, type Answer, type Session, type Walk } from "./walk"

export interface Env {
  BRINE: KVNamespace
  BRINE_AUDIO: R2Bucket
  OPENROUTER_API_KEY?: string
  BRINE_ADMIN_TOKEN?: string
  BRINE_STT_MODEL?: string
  BRINE_DECIDE_MODEL?: string
}

interface Invite {
  code: string
  name: string
  created: string
}

interface Recording {
  id: string
  code: string // whose
  q: string
  type: string
  bytes: number
  seconds: number
  created: string
  transcript?: string
  model?: string
  error?: string
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
const fail = (status: number, error: string) => json({ error }, status)
const bearer = (req: Request) => req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/)?.[1]?.trim()

const MAX_AUDIO = 25 * 1024 * 1024 // the transcription endpoint's limit; about 25 minutes of opus

export function brine(interview: Interview) {
  const walk = compile(interview)

  return {
    async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "")
      if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 })
      try {
        if (path.startsWith("/api/admin/")) {
          const token = bearer(req)
          if (!env.BRINE_ADMIN_TOKEN || !token || !same(token, env.BRINE_ADMIN_TOKEN)) return fail(401, "admin token required")
          return await admin(req, env, ctx, walk, path, url)
        }
        const code = bearer(req)
        const invite = code ? await env.BRINE.get<Invite>(`invite:${code}`, "json") : null
        if (!invite) return fail(401, "This link is not valid. Ask for a new one.")
        return await respondent(req, env, ctx, walk, invite, path, url)
      } catch (e) {
        console.error(e)
        return fail(500, "Something went wrong on our side. Your answers so far are saved.")
      }
    },
  }
}

async function load(env: Env, walk: Walk, code: string): Promise<Session> {
  return (await env.BRINE.get<Session>(`session:${code}`, "json")) ?? begin(walk)
}
const save = (env: Env, code: string, s: Session) => env.BRINE.put(`session:${code}`, JSON.stringify(s))

async function respondent(req: Request, env: Env, ctx: ExecutionContext, walk: Walk, invite: Invite, path: string, url: URL) {
  const view = (s: Session) => ({ respondent: invite.name, session: s, progress: progress(walk, s) })

  if (path === "/api/session" && req.method === "GET") {
    const s = await load(env, walk, invite.code)
    await save(env, invite.code, s)
    return json(view(s))
  }

  if (path === "/api/answer" && req.method === "POST") {
    const body = (await req.json()) as { q?: string; value?: Answer["value"]; note?: string; voice?: string[]; skipped?: boolean }
    const s = await load(env, walk, invite.code)
    const q = body.q
    if (!q || q !== s.at) return json({ ...view(s), stale: true }, 409)
    const node = walk.byId.get(q)!
    const a: Omit<Answer, "at"> = body.skipped
      ? { skipped: true }
      : { value: clean(body.value), note: body.note?.trim() || undefined, voice: body.voice?.length ? body.voice.slice(0, 20) : undefined }
    let decisions: Record<string, string> = {}
    if (node.question.decide && !a.skipped) decisions = await decide(env, walk, q, a)
    const next = answer(walk, s, q, a, decisions)
    await save(env, invite.code, next)
    // Anything recorded for this answer that is not transcribed yet gets transcribed now.
    if (a.voice?.length) ctx.waitUntil(Promise.all(a.voice.map((id) => transcribe(env, id))))
    return json(view(next))
  }

  if (path === "/api/back" && req.method === "POST") {
    const s = back(await load(env, walk, invite.code))
    await save(env, invite.code, s)
    return json(view(s))
  }

  if (path === "/api/jump" && req.method === "POST") {
    const { chapter } = (await req.json()) as { chapter: string }
    const s = jump(walk, await load(env, walk, invite.code), chapter)
    await save(env, invite.code, s)
    return json(view(s))
  }

  if (path === "/api/voice" && req.method === "POST") {
    const q = url.searchParams.get("q") ?? ""
    if (!walk.byId.has(q)) return fail(400, "unknown question")
    const type = (req.headers.get("content-type") ?? "audio/webm").split(";")[0]
    if (!type.startsWith("audio/")) return fail(415, "audio only")
    const body = await req.arrayBuffer()
    if (!body.byteLength) return fail(400, "empty recording")
    if (body.byteLength > MAX_AUDIO) return fail(413, "That recording is too long. Try splitting it into two.")
    const id = crypto.randomUUID()
    const seconds = Number(url.searchParams.get("seconds")) || 0
    await env.BRINE_AUDIO.put(`audio/${invite.code}/${id}`, body, { httpMetadata: { contentType: type }, customMetadata: { q, seconds: String(seconds) } })
    const rec: Recording = { id, code: invite.code, q, type, bytes: body.byteLength, seconds, created: new Date().toISOString() }
    await env.BRINE.put(`voice:${id}`, JSON.stringify(rec))
    // Start transcribing straight away, so a decision on this answer rarely has to wait.
    ctx.waitUntil(transcribe(env, id))
    return json({ id, seconds })
  }

  const del = path.match(/^\/api\/voice\/([\w-]+)$/)
  if (del && req.method === "DELETE") {
    const rec = await env.BRINE.get<Recording>(`voice:${del[1]}`, "json")
    if (!rec || rec.code !== invite.code) return fail(404, "no such recording")
    const s = await load(env, walk, invite.code)
    // Recordings already part of a submitted answer stay: they are what was said.
    if (Object.values(s.answers).some((a) => a.voice?.includes(rec.id))) return json({ kept: true })
    await Promise.all([env.BRINE.delete(`voice:${rec.id}`), env.BRINE_AUDIO.delete(`audio/${rec.code}/${rec.id}`)])
    return json({ deleted: true })
  }

  return fail(404, "no such route")
}

function clean(v: Answer["value"]): Answer["value"] {
  if (typeof v === "string") return v.trim().slice(0, 20_000) || undefined
  if (Array.isArray(v)) return v.map(String).slice(0, 50)
  if (typeof v === "number" && Number.isFinite(v)) return v
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Transcription: a speech-to-text model through OpenRouter's /audio/transcriptions.

async function transcribe(env: Env, id: string, force = false): Promise<Recording | null> {
  const rec = await env.BRINE.get<Recording>(`voice:${id}`, "json")
  if (!rec || (rec.transcript !== undefined && !force) || !env.OPENROUTER_API_KEY) return rec
  const obj = await env.BRINE_AUDIO.get(`audio/${rec.code}/${rec.id}`)
  if (!obj) return rec
  const model = env.BRINE_STT_MODEL || "openai/gpt-4o-mini-transcribe"
  const ext = rec.type.includes("mp4") || rec.type.includes("m4a") || rec.type.includes("aac") ? "m4a" : rec.type.includes("ogg") ? "ogg" : rec.type.includes("wav") ? "wav" : rec.type.includes("mpeg") ? "mp3" : "webm"
  const form = new FormData()
  form.append("model", model)
  form.append("file", new File([await obj.arrayBuffer()], `answer.${ext}`, { type: rec.type }))
  try {
    const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "x-title": "brine" }, body: form })
    const out = (await res.json()) as { text?: string; error?: { message?: string } }
    if (!res.ok || typeof out.text !== "string") throw new Error(out.error?.message ?? `HTTP ${res.status}`)
    Object.assign(rec, { transcript: out.text.trim(), model, error: undefined })
  } catch (e) {
    rec.error = String((e as Error).message ?? e).slice(0, 300)
  }
  await env.BRINE.put(`voice:${id}`, JSON.stringify(rec))
  return rec
}

// Everything the respondent said for one answer, as text: the choice, the typed words, the
// transcripts in order.
async function spoken(env: Env, walk: Walk, id: string, a: Omit<Answer, "at">, wait: boolean): Promise<string> {
  const q = walk.byId.get(id)!.question
  const parts: string[] = []
  const label = (v: string) => q.options?.find((o) => o.value === v)?.label ?? q.scale?.[Number(v)] ?? v
  if (Array.isArray(a.value)) parts.push(a.value.map(label).join(", "))
  else if (a.value !== undefined) parts.push(q.kind === "long" || q.kind === "text" ? String(a.value) : `${label(String(a.value))}${q.unit ? ` ${q.unit}` : ""}`)
  if (a.note) parts.push(a.note)
  for (const v of a.voice ?? []) {
    const rec = wait ? await transcribe(env, v) : await env.BRINE.get<Recording>(`voice:${v}`, "json")
    if (rec?.transcript) parts.push(rec.transcript)
  }
  return parts.filter(Boolean).join("\n\n")
}

// ---------------------------------------------------------------------------------------------
// Decisions: Jev reads the answer and answers the question's typed questions about it.

async function decide(env: Env, walk: Walk, id: string, a: Omit<Answer, "at">): Promise<Record<string, string>> {
  const q = walk.byId.get(id)!.question
  const fallback = fallbacks(q)
  if (!env.OPENROUTER_API_KEY) return fallback
  const text = await spoken(env, walk, id, a, true)
  if (!text.trim()) return fallback
  const questions = Object.fromEntries(
    Object.entries(q.decide!).map(([k, d]) => [
      k,
      { type: d.type, instructions: d.instructions, ...(d.criteria ? { criteria: d.criteria } : {}) },
    ]),
  )
  try {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", "x-title": "brine" },
      body: JSON.stringify({
        model: env.BRINE_DECIDE_MODEL || "typesafe/jev-1.13",
        state: { interview: walk.interview.title, question: q.ask, answer: text.slice(0, 60_000) },
        questions,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const out = (await res.json()) as { answers?: Record<string, { type: string; noul?: number; choice?: string; score?: number; probabilities?: Record<string, number> }> }
    const result: Record<string, string> = { ...fallback }
    for (const [k, d] of Object.entries(q.decide!)) {
      const r = out.answers?.[k]
      if (!r) continue
      if (d.type === "noul" && typeof r.noul === "number") result[k] = r.noul >= (d.threshold ?? 0.5) ? "yes" : "no"
      if (d.type === "choice" && typeof r.choice === "string") result[k] = r.choice
      if (d.type === "score" && r.probabilities) result[k] = Object.entries(r.probabilities).sort((x, y) => y[1] - x[1])[0][0]
    }
    return result
  } catch (e) {
    console.error("decide", id, e)
    return fallback
  }
}

// ---------------------------------------------------------------------------------------------
// Admin: invites and the export the Gherkin pass reads.

async function admin(req: Request, env: Env, ctx: ExecutionContext, walk: Walk, path: string, url: URL) {
  if (path === "/api/admin/invite" && req.method === "POST") {
    const { name } = (await req.json()) as { name?: string }
    if (!name?.trim()) return fail(400, "name required")
    const code = token()
    const invite: Invite = { code, name: name.trim(), created: new Date().toISOString() }
    await env.BRINE.put(`invite:${code}`, JSON.stringify(invite))
    return json({ ...invite, link: `${url.origin}/?i=${code}` })
  }

  if (path === "/api/admin/invites" && req.method === "GET") {
    const invites = await all<Invite>(env, "invite:")
    const rows = await Promise.all(
      invites.map(async (i) => {
        const s = await env.BRINE.get<Session>(`session:${i.code}`, "json")
        return { name: i.name, code: i.code, created: i.created, answered: s ? Object.keys(s.answers).length : 0, at: s?.at ?? null, finished: s?.finished ?? null }
      }),
    )
    return json(rows)
  }

  if (path === "/api/admin/export" && req.method === "GET") {
    const invites = await all<Invite>(env, "invite:")
    const people = []
    for (const i of invites) {
      const s = await env.BRINE.get<Session>(`session:${i.code}`, "json")
      if (!s) continue
      const asked = []
      for (const id of Object.keys(s.answers).sort((x, y) => (walk.byId.get(x)?.index ?? 0) - (walk.byId.get(y)?.index ?? 0))) {
        const n = walk.byId.get(id)
        if (!n) continue
        const a = s.answers[id]
        const recordings = await Promise.all((a.voice ?? []).map((v) => env.BRINE.get<Recording>(`voice:${v}`, "json")))
        asked.push({
          id,
          chapter: n.chapter.title,
          ask: n.question.ask,
          kind: n.question.kind,
          why: n.question.why,
          yields: n.question.yields,
          skipped: Boolean(a.skipped),
          value: a.value,
          label: labelOf(n.question, a.value),
          note: a.note,
          recordings: recordings.filter(Boolean).map((r) => ({ id: r!.id, seconds: r!.seconds, transcript: r!.transcript ?? null, error: r!.error })),
          decisions: Object.fromEntries(Object.entries(s.decisions).filter(([k]) => k.startsWith(`${id}.`)).map(([k, v]) => [k.slice(id.length + 1), v])),
          at: a.at,
        })
      }
      people.push({ name: i.name, code: i.code, started: s.started, finished: s.finished ?? null, at: s.at === END ? null : s.at, answers: asked })
    }
    return json({ interview: { id: walk.interview.id, title: walk.interview.title, glossary: walk.interview.glossary ?? {} }, exported: new Date().toISOString(), people })
  }

  const audio = path.match(/^\/api\/admin\/audio\/([\w-]+)$/)
  if (audio && req.method === "GET") {
    const rec = await env.BRINE.get<Recording>(`voice:${audio[1]}`, "json")
    const obj = rec && (await env.BRINE_AUDIO.get(`audio/${rec.code}/${rec.id}`))
    if (!obj) return fail(404, "no such recording")
    return new Response(obj.body, { headers: { "content-type": rec!.type } })
  }

  if (path === "/api/admin/transcribe" && req.method === "POST") {
    const { id } = (await req.json().catch(() => ({}))) as { id?: string }
    const recs = id ? [await env.BRINE.get<Recording>(`voice:${id}`, "json")] : await all<Recording>(env, "voice:")
    const todo = recs.filter((r): r is Recording => Boolean(r) && (Boolean(id) || r!.transcript === undefined))
    const done = await Promise.all(todo.map((r) => transcribe(env, r.id, true)))
    return json(done.map((r) => ({ id: r?.id, ok: Boolean(r?.transcript !== undefined && !r?.error), error: r?.error })))
  }

  return fail(404, "no such route")
}

function labelOf(q: Interview["chapters"][number]["questions"][number], v: Answer["value"]) {
  if (v === undefined) return undefined
  const one = (x: string) => q.options?.find((o) => o.value === x)?.label ?? q.scale?.[Number(x)] ?? x
  return Array.isArray(v) ? v.map(one) : q.kind === "long" || q.kind === "text" || q.kind === "number" ? undefined : one(String(v))
}

async function all<T>(env: Env, prefix: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  do {
    const page = await env.BRINE.list({ prefix, cursor })
    for (const k of page.keys) {
      const v = await env.BRINE.get<T>(k.name, "json")
      if (v) out.push(v)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return out
}

function token() {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
