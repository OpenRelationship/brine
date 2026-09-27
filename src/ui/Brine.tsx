// The respondent's side: one question at a time. The walk lives on the server (the Worker in
// ../worker.ts); this page shows the question on screen and sends what is said.
//
// A question is three things and nothing else: the question, a line of context under it, and
// "ways to think about it" at the bottom. Where they are in the whole is behind "Chapters".
//
// Nothing typed or recorded is lost. The box is kept in the browser as it changes (a reload
// restores it), and leaving a question any way other than Next (Back, the chapter list, another
// question, closing the tab) saves what is in the box to the server first. Earlier answers can be
// opened from the chapter list, edited and saved; the respondent then returns to where they left
// off, which the server recomputes, so a changed answer that opens a new follow-up asks it.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Interview, Question } from "../spec"
import { compile, END, type Answer, type Session, type Status } from "../walk"
import { clock, Recorder, WaveIcon, type Recorded } from "./Recorder"

export interface Brand {
  name: string //   shown beside the mark
  mark?: ReactNode // an <img> or <svg>
}

interface Row {
  id: string
  ask: string
  status: Status
  voice: number
}
interface View {
  respondent: string
  session: Session
  path: string[]
  frontier: string
  progress: { id: string; title: string; part?: string; total: number; answered: number; questions: Row[] }[]
}

const local = {
  get<T>(key: string, fallback: T): T {
    try {
      return (JSON.parse(localStorage.getItem(`brine.${key}`) ?? "null") as T) ?? fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      value === undefined ? localStorage.removeItem(`brine.${key}`) : localStorage.setItem(`brine.${key}`, JSON.stringify(value))
    } catch {}
  },
}

function inviteCode(): string | null {
  const url = new URL(location.href)
  const fresh = url.searchParams.get("i")
  if (fresh) {
    local.set("code", fresh)
    url.searchParams.delete("i")
    history.replaceState(null, "", url.pathname + url.search + url.hash)
    return fresh
  }
  return local.get<string | null>("code", null)
}

class Gone extends Error {}

async function call<T>(code: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, { ...init, headers: { authorization: `Bearer ${code}`, ...(init.body && !(init.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...init.headers } })
  const body = (await res.json().catch(() => ({}))) as { error?: string; session?: unknown }
  if (res.status === 401) throw new Gone(body.error)
  if (res.status === 409 && body.session) return body as T // answered elsewhere meanwhile; take the server's walk
  if (!res.ok) throw new Error(body.error || "We couldn't reach the server. Check your connection and try again.")
  return body as T
}

const post = (code: string, path: string, body: unknown = {}) => call<View>(code, path, { method: "POST", body: JSON.stringify(body) })

const paragraphs = (text: string) => text.split(/\n\n+/).map((p, i) => <p key={i} className="brine-lede">{p}</p>)

// theme: "auto" follows the device; "light" or "dark" pins it (for brands with one theme).
export function Brine({ interview, brand, theme = "auto" }: { interview: Interview; brand: Brand; theme?: "auto" | "light" | "dark" }) {
  const walk = useMemo(() => compile(interview), [interview])
  const [code] = useState(inviteCode)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(!code)
  const [started, setStarted] = useState(false)
  const [contents, setContents] = useState(false)
  // The question on screen registers how to save its box; every way out calls it first.
  const flush = useRef<(() => Promise<void>) | null>(null)

  const run = useCallback(async (p: Promise<View>) => {
    try {
      setView(await p)
      setError(null)
    } catch (e) {
      if (e instanceof Gone) setGone(true)
      else setError((e as Error).message)
      throw e
    }
  }, [])
  // Save the box, then go.
  const leave = useCallback(
    async (to: () => Promise<View>) => {
      try {
        await flush.current?.()
        await run(to())
        return true
      } catch {
        return false
      }
    },
    [run],
  )

  useEffect(() => {
    if (code) run(call<View>(code, "session")).catch(() => {})
  }, [code, run])

  const shell = (body: ReactNode) => (
    <div className="brine" data-theme={theme === "auto" ? undefined : theme}>
      <header className="brine-bar">
        <span className="brine-brand">
          {brand.mark}
          <span>{brand.name}</span>
        </span>
        <span className="brine-grow" />
        {view && started && (
          <button
            type="button"
            className="brine-link"
            aria-expanded={contents}
            onClick={async () => {
              if (contents) return setContents(false)
              try {
                await flush.current?.()
                setContents(true)
              } catch {}
            }}
          >
            {contents ? "Close" : "Chapters"}
          </button>
        )}
      </header>
      <main className="brine-column">{body}</main>
    </div>
  )

  if (gone)
    return shell(
      <section>
        <h1>This interview is by invitation.</h1>
        <p className="brine-lede">Open the link you were sent. If it stopped working, ask for a new one; your answers are kept.</p>
      </section>,
    )
  if (!view) return shell(error ? <p className="brine-error" role="alert">{error}</p> : <p className="brine-lede">Loading…</p>)

  const s = view.session
  const first = view.respondent.split(/\s+/)[0]
  const count = Object.keys(s.answers).length

  if (!started)
    return shell(
      <section className="brine-welcome">
        <h1>{count === 0 ? interview.welcome.heading.replace("{name}", first) : `Welcome back, ${first}.`}</h1>
        {count === 0
          ? paragraphs(interview.welcome.body)
          : paragraphs(view.frontier === END ? "You've answered everything. You can still open any chapter and change an answer." : `You've answered ${count} so far. We'll pick up where you left off.`)}
        <div className="brine-row">
          <button
            type="button"
            className="brine-key brine-accent"
            autoFocus
            onClick={() => (count === 0 ? setStarted(true) : run(post(code!, "resume")).then(() => setStarted(true), () => {}))}
          >
            {count === 0 ? "Begin" : view.frontier === END ? "Review" : "Keep going"} →
          </button>
        </div>
        <Chapters view={view} walk={walk} />
      </section>,
    )

  if (contents)
    return shell(
      <section>
        <h1>Chapters</h1>
        <p className="brine-lede">Open a chapter to see its questions. Pick one to answer it or change what you said. Everything is saved as you go.</p>
        {view.frontier !== END && s.at !== view.frontier && (
          <div className="brine-row">
            <button type="button" className="brine-key brine-accent" onClick={() => run(post(code!, "resume")).then(() => setContents(false), () => {})}>
              Continue where you left off →
            </button>
          </div>
        )}
        <Chapters view={view} walk={walk} onOpen={(q) => run(post(code!, "goto", { q })).then(() => setContents(false), () => {})} />
      </section>,
    )

  if (s.at === END)
    return shell(
      <section className="brine-welcome">
        <h1>{interview.farewell.heading.replace("{name}", first)}</h1>
        {paragraphs(interview.farewell.body)}
        <div className="brine-row">
          <button type="button" className="brine-key" onClick={() => setContents(true)}>Change an answer</button>
        </div>
      </section>,
    )

  return shell(<Ask key={s.at} code={code!} walk={walk} view={view} error={error} run={run} leave={leave} flush={flush} />)
}

// The chapter list as an index: parts, then numbered chapters, then numbered questions, each
// level indented on a guide line, each row with its status. Without onOpen it is a read-only
// outline (the welcome page); with it, chapters open and questions can be picked.
function Chapters({ view, walk, onOpen }: { view: View; walk: ReturnType<typeof compile>; onOpen?: (q: string) => void }) {
  const here = walk.byId.get(view.session.at)?.chapter.id
  const [open, setOpen] = useState<string | null>(onOpen ? (here ?? null) : null)
  const rows = view.progress.filter((c) => c.total > 0)
  // Consecutive chapters that share a part are listed under it, in the order of the process.
  const groups: { part?: string; rows: (typeof rows[number] & { n: number })[] }[] = []
  rows.forEach((c, i) => {
    const last = groups[groups.length - 1]
    const row = { ...c, n: i + 1 }
    if (last && last.part === c.part) last.rows.push(row)
    else groups.push({ part: c.part, rows: [row] })
  })
  const reached = new Set([...view.path, view.frontier])
  const pad = (n: number) => String(n).padStart(2, "0")

  return (
    <div className="brine-index">
      {groups.map((g, gi) => {
        const answered = g.rows.reduce((k, c) => k + c.answered, 0)
        const total = g.rows.reduce((k, c) => k + c.total, 0)
        return (
          <section key={gi} className="brine-index-part">
            {g.part && (
              <header>
                <span className="brine-index-tab">Part {gi + 1}</span>
                <span className="brine-grow">{g.part}</span>
                <span className="brine-count">{answered} / {total}</span>
              </header>
            )}
            <ul className="brine-index-tree">
              {g.rows.map((c) => {
                const done = c.answered >= c.total
                const isOpen = Boolean(onOpen) && open === c.id
                const inner = (
                  <>
                    <Ring value={c.answered / c.total} />
                    <span className="brine-index-num">{pad(c.n)}</span>
                    <span className="brine-grow brine-index-title">{c.title}</span>
                    <span className="brine-count">{done ? "done" : `${c.answered} / ${c.total}`}</span>
                    {onOpen && <Chevron open={isOpen} />}
                  </>
                )
                return (
                  <li key={c.id} className={`${c.id === here ? "here" : ""} ${done ? "done" : ""}`}>
                    {onOpen ? (
                      <button type="button" className="brine-index-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>{inner}</button>
                    ) : (
                      <div className="brine-index-row">{inner}</div>
                    )}
                    {isOpen && (
                      <ul className="brine-index-tree brine-index-questions">
                        {c.questions.map((q, qi) => {
                          const now = q.id === view.session.at
                          const next = q.status === "open" && reached.has(q.id)
                          return (
                            <li key={q.id} className={`${now ? "here" : ""} ${q.status}`}>
                              <button type="button" className="brine-index-row" onClick={() => onOpen!(q.id)}>
                                <Mark status={q.status} next={next} />
                                <span className="brine-index-num">{c.n}.{qi + 1}</span>
                                <span className="brine-grow">{q.ask}</span>
                                {q.voice > 0 && (
                                  <span className="brine-count brine-index-voice" title={`${q.voice} recording${q.voice > 1 ? "s" : ""}`}>
                                    <WaveIcon size={13} />
                                    {q.voice > 1 ? q.voice : ""}
                                  </span>
                                )}
                                {now ? <span className="brine-count">here</span> : next ? <span className="brine-count">next</span> : q.status === "skipped" ? <span className="brine-count">skipped</span> : null}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// A chapter's progress: an empty circle, a filling ring, or a filled check.
function Ring({ value }: { value: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  if (value >= 1)
    return (
      <svg className="brine-icon brine-icon-done" width="18" height="18" viewBox="0 0 18 18" aria-label="done">
        <circle cx="9" cy="9" r="8" />
        <path d="M5.5 9.2l2.3 2.3 4.7-4.9" fill="none" />
      </svg>
    )
  return (
    <svg className="brine-icon brine-icon-ring" width="18" height="18" viewBox="0 0 18 18" aria-label={`${Math.round(value * 100)}% answered`}>
      <circle cx="9" cy="9" r={r} className="track" />
      {value > 0 && <circle cx="9" cy="9" r={r} className="fill" strokeDasharray={`${value * c} ${c}`} transform="rotate(-90 9 9)" />}
    </svg>
  )
}

// A question's status: answered (check), skipped (dash), next up (filled dot), not yet (circle).
function Mark({ status, next }: { status: Status; next: boolean }) {
  return (
    <svg className={`brine-icon brine-mark ${status} ${next ? "next" : ""}`} width="16" height="16" viewBox="0 0 16 16" aria-label={next ? "next" : status === "open" ? "not yet" : status}>
      {status === "answered" ? (
        <>
          <circle cx="8" cy="8" r="7" />
          <path d="M4.8 8.2l2 2 4.3-4.4" fill="none" />
        </>
      ) : status === "skipped" ? (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8h6" />
        </>
      ) : (
        <circle cx="8" cy="8" r={next ? 4 : 6} />
      )}
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`brine-icon brine-chevron ${open ? "open" : ""}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M5 3l4 4-4 4" fill="none" />
    </svg>
  )
}

interface Draft {
  value?: Answer["value"]
  note?: string
  voice: Recorded[]
  noteOpen?: boolean
}

const fromAnswer = (q: Question, a: Answer | undefined): Draft => ({
  value: a?.skipped ? (q.kind === "multi" ? [] : undefined) : (a?.value ?? (q.kind === "multi" ? [] : undefined)),
  note: a?.note,
  voice: (a?.voice ?? []).map((id) => ({ id, seconds: 0 })),
  noteOpen: Boolean(a?.note || (q.kind !== "long" && a?.voice?.length)),
})

const empty = (d: Draft) => !(Array.isArray(d.value) ? d.value.length : d.value !== undefined && String(d.value).trim() !== "") && !d.note?.trim() && d.voice.length === 0

// What the server would store for this draft. An emptied box is stored as skipped.
const payload = (d: Draft) => (empty(d) ? { skipped: true } : { value: d.value, note: d.note?.trim() || undefined, voice: d.voice.map((v) => v.id) })
function same(d: Draft, a: Answer | undefined) {
  if (!a) return false
  const p = payload(d) as { skipped?: boolean; value?: unknown; note?: string; voice?: string[] }
  if (p.skipped || a.skipped) return Boolean(p.skipped) === Boolean(a.skipped)
  const val = (v: unknown) => JSON.stringify(typeof v === "string" ? v.trim() || null : (v ?? null))
  return val(p.value) === val(a.value) && (p.note ?? "") === (a.note ?? "") && JSON.stringify(p.voice ?? []) === JSON.stringify(a.voice ?? [])
}

function Ask({
  code,
  walk,
  view,
  error,
  run,
  leave,
  flush,
}: {
  code: string
  walk: ReturnType<typeof compile>
  view: View
  error: string | null
  run: (p: Promise<View>) => Promise<void>
  leave: (to: () => Promise<View>) => Promise<boolean>
  flush: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const s = view.session
  const q = walk.byId.get(s.at)!.question
  const saved = s.answers[s.at]
  const revisiting = s.at !== view.frontier
  const draftKey = `draft.${code.slice(0, 6)}.${s.at}`
  const [draft, setDraftState] = useState<Draft>(() => local.get<Draft>(draftKey, fromAnswer(q, saved)))
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const latest = useRef(draft)
  latest.current = draft
  const setDraft = (fn: (d: Draft) => Draft) =>
    setDraftState((d) => {
      const next = fn(d)
      local.set(draftKey, next)
      return next
    })
  // Changed from what the server has. An untouched, never-answered question is not a change.
  const dirty = (d: Draft) => !same(d, saved) && !(empty(d) && !saved)

  // Every way out of this question saves the box first, unless it already matches what's saved.
  useEffect(() => {
    flush.current = async () => {
      const d = latest.current
      if (dirty(d)) await run(post(code, "save", { q: s.at, ...payload(d) }))
      local.set(draftKey, undefined)
    }
    // Closing the tab: a keepalive request carries the box to the server.
    const onHide = () => {
      const d = latest.current
      if (!dirty(d)) return
      fetch("/api/save", { method: "POST", keepalive: true, headers: { authorization: `Bearer ${code}`, "content-type": "application/json" }, body: JSON.stringify({ q: s.at, ...payload(d) }) }).catch(() => {})
    }
    addEventListener("pagehide", onHide)
    return () => {
      flush.current = null
      removeEventListener("pagehide", onHide)
    }
  }, [s.at])

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const go = async (how: "next" | "return") => {
    if (busy || recording) return
    setBusy(true)
    try {
      if (how === "next") await run(post(code, "answer", { q: s.at, ...payload(latest.current) }))
      else {
        if (dirty(latest.current)) await run(post(code, "save", { q: s.at, ...payload(latest.current) }))
        await run(post(code, "resume"))
      }
      local.set(draftKey, undefined)
    } catch {
      setBusy(false)
    }
  }
  const back = async () => {
    if (busy || recording) return
    setBusy(true)
    if (!(await leave(() => post(code, "back")))) setBusy(false)
  }

  const upload = async (blob: Blob, seconds: number) => {
    const r = await call<Recorded>(code, `voice?q=${encodeURIComponent(s.at)}&seconds=${seconds}`, { method: "POST", body: blob, headers: { "content-type": blob.type || "audio/webm" } })
    return { id: r.id, seconds }
  }
  const forget = (id: string) => {
    setDraft((d) => ({ ...d, voice: d.voice.filter((v) => v.id !== id) }))
    // An unsaved recording is deleted; one already in a saved answer stays on the server.
    call(code, `voice/${id}`, { method: "DELETE" }).catch(() => {})
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (q.kind !== "long" || e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault()
      go(revisiting ? "return" : "next")
    }
  }

  // Number keys pick options on choice, multi and scale questions.
  useEffect(() => {
    if (q.kind !== "choice" && q.kind !== "scale" && q.kind !== "multi") return
    const opts = q.kind === "scale" ? q.scale!.map((_, i) => String(i)) : q.options!.map((o) => o.value)
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < opts.length) {
        const v = opts[i]
        setDraft((d) => (q.kind === "multi" ? { ...d, value: toggle(d.value as string[] | undefined, v) } : { ...d, value: v }))
      }
    }
    addEventListener("keydown", onDown)
    return () => removeEventListener("keydown", onDown)
  }, [q])

  const box = (placeholder: string, field: "value" | "note") => (
    <div className={`brine-box ${recording ? "recording" : ""}`}>
      <textarea
        ref={field === "value" || q.kind !== "long" ? input : undefined}
        rows={field === "value" ? 5 : 3}
        placeholder={placeholder}
        aria-label={field === "value" ? q.ask : "Anything to add"}
        value={(field === "value" ? (draft.value as string) : draft.note) ?? ""}
        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
        onKeyDown={onKey}
      />
      <div className="brine-box-foot">
        {draft.voice.map((v, i) => (
          <span key={v.id} className="brine-chip-voice">
            <WaveIcon size={14} />
            {v.seconds ? `Recording ${i + 1} · ${clock(v.seconds)}` : `Recording ${i + 1}`}
            <button type="button" aria-label={`Remove recording ${i + 1}`} onClick={() => forget(v.id)}>×</button>
          </span>
        ))}
        <span className="brine-grow" />
        <Recorder upload={upload} onBusy={setRecording} onRecorded={(r) => setDraft((d) => ({ ...d, voice: [...d.voice, r] }))} />
      </div>
    </div>
  )

  const has = !empty(draft)
  const changed = dirty(draft)
  const talks = Boolean(q.decide) && draft.voice.length > 0
  const hints = q.hint === undefined ? [] : Array.isArray(q.hint) ? q.hint : [q.hint]
  const pick = (v: string) => setDraft((d) => (q.kind === "multi" ? { ...d, value: toggle(d.value as string[] | undefined, v) } : { ...d, value: d.value === v ? undefined : v }))

  return (
    <section className="brine-question">
      {revisiting && (
        <p className="brine-revisit">
          {saved ? "This is an earlier answer. Change anything you like; it's saved when you leave." : "You've skipped ahead to this one."}{" "}
          {view.frontier !== END && (
            <button type="button" className="brine-link" disabled={busy || recording} onClick={() => go("return")}>
              Back to where you left off
            </button>
          )}
        </p>
      )}
      <h1>{q.ask}</h1>
      {q.context && <p className="brine-context">{q.context}</p>}

      {q.kind === "long" && box("Type here, or press Talk and just say it.", "value")}

      {q.kind === "text" && <input ref={input} className="brine-well" aria-label={q.ask} value={(draft.value as string) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} onKeyDown={onKey} />}

      {q.kind === "number" && (
        <div className="brine-number">
          <input ref={input} className="brine-well" type="number" inputMode="decimal" aria-label={q.ask} value={(draft.value as number | undefined) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value === "" ? undefined : Number(e.target.value) }))} onKeyDown={onKey} />
          {q.unit && <span className="brine-unit">{q.unit}</span>}
        </div>
      )}

      {(q.kind === "choice" || q.kind === "multi") && (
        <div className={q.kind === "choice" ? "brine-choices" : "brine-chips"} role={q.kind === "choice" ? "radiogroup" : "group"}>
          {q.options!.map((o) => {
            const on = q.kind === "multi" ? ((draft.value as string[] | undefined) ?? []).includes(o.value) : draft.value === o.value
            return (
              <button key={o.value} type="button" role={q.kind === "choice" ? "radio" : "checkbox"} aria-checked={on} className={`brine-option ${on ? "on" : ""}`} onClick={() => pick(o.value)}>
                {o.label}
              </button>
            )
          })}
        </div>
      )}

      {q.kind === "scale" && (
        <div className="brine-scale" role="radiogroup">
          {q.scale!.map((label, i) => (
            <button key={i} type="button" role="radio" aria-checked={draft.value === String(i)} className={`brine-option ${draft.value === String(i) ? "on" : ""}`} onClick={() => pick(String(i))}>
              {label}
            </button>
          ))}
        </div>
      )}

      {q.kind !== "long" && (q.note || q.decide) && (draft.noteOpen ? box("Anything to add? Type it, or press Talk.", "note") : (
        <button type="button" className="brine-link brine-add" onClick={() => setDraft((d) => ({ ...d, noteOpen: true }))}>
          <WaveIcon size={16} /> Add a note, typed or spoken
        </button>
      ))}

      {error && <p className="brine-error" role="alert">{error}</p>}

      <div className="brine-row">
        <button type="button" className="brine-key" disabled={busy || recording || view.path.length === 0 || view.path[0] === s.at} onClick={back}>← Back</button>
        <span className="brine-grow" />
        {revisiting ? (
          <>
            <button type="button" className="brine-link" disabled={busy || recording} onClick={() => go("next")}>Next question</button>
            <button type="button" className="brine-key brine-accent" disabled={busy || recording} onClick={() => go("return")}>
              {busy ? (talks ? "Listening…" : "Saving…") : changed ? "Save and go back →" : "Back to where I was →"}
            </button>
          </>
        ) : (
          <button type="button" className={`brine-key ${has ? "brine-accent" : ""}`} disabled={busy || recording} onClick={() => go("next")}>
            {busy ? (talks ? "Listening…" : "Saving…") : has ? "Next →" : "Skip →"}
          </button>
        )}
      </div>

      {hints.length > 0 && (
        <aside className="brine-hints">
          <p>Ways to think about it</p>
          <ul>
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  )
}

const toggle = (xs: string[] | undefined, v: string) => ((xs ?? []).includes(v) ? (xs ?? []).filter((x) => x !== v) : [...(xs ?? []), v])

export type { Question }
