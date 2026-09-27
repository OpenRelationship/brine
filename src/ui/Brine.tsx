// The respondent's side: one question at a time, chapter by chapter. The walk lives on the server
// (the Worker in ../worker.ts); this page shows where it is, sends each answer, and keeps an
// unsent draft in the browser so a reload loses nothing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Interview, Question } from "../spec"
import { compile, END, type Answer, type Session } from "../walk"
import { clock, Recorder, WaveIcon, type Recorded } from "./Recorder"

export interface Brand {
  name: string //   shown beside the mark
  mark?: ReactNode // an <img> or <svg>
}

interface View {
  respondent: string
  session: Session
  progress: { id: string; title: string; part?: string; total: number; answered: number }[]
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
  if (res.status === 409 && body.session) return body as T // someone answered elsewhere; take the server's walk
  if (!res.ok) throw new Error(body.error || "We couldn't reach the server. Check your connection and try again.")
  return body as T
}

export function Brine({ interview, brand }: { interview: Interview; brand: Brand }) {
  const walk = useMemo(() => compile(interview), [interview])
  const [code] = useState(inviteCode)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(!code)
  const [started, setStarted] = useState(false)
  const [contents, setContents] = useState(false)

  const run = async (p: Promise<View>) => {
    try {
      setView(await p)
      setError(null)
    } catch (e) {
      if (e instanceof Gone) setGone(true)
      else setError((e as Error).message)
      throw e
    }
  }

  useEffect(() => {
    if (code) run(call<View>(code, "session")).catch(() => {})
  }, [code])

  const shell = (body: ReactNode, wide = false) => (
    <div className="brine">
      <header className="brine-bar">
        <span className="brine-brand">
          {brand.mark}
          <span>{brand.name}</span>
        </span>
        <span className="brine-grow" />
        {view && started && view.session.at !== END && (
          <button type="button" className="brine-link" onClick={() => setContents((x) => !x)} aria-expanded={contents}>
            {contents ? "Back to the question" : "Chapters"}
          </button>
        )}
      </header>
      <main className={`brine-column ${wide ? "wide" : ""}`}>{body}</main>
    </div>
  )

  if (gone)
    return shell(
      <section className="brine-note">
        <h1>This interview is by invitation.</h1>
        <p className="brine-soft">Open the link you were sent. If it stopped working, ask for a new one; your answers are kept.</p>
      </section>,
    )
  if (!view) return shell(error ? <p className="brine-error" role="alert">{error}</p> : <p className="brine-soft">Loading…</p>)

  const s = view.session
  const first = view.respondent.split(/\s+/)[0]
  const fresh = Object.keys(s.answers).length === 0

  if (!started && s.at !== END)
    return shell(
      <section className="brine-welcome">
        <p className="brine-label">{interview.title}</p>
        <h1>{fresh ? interview.welcome.heading.replace("{name}", first) : `Welcome back, ${first}.`}</h1>
        {fresh ? (
          interview.welcome.body.split(/\n\n+/).map((p, i) => <p key={i} className="brine-lede">{p}</p>)
        ) : (
          <p className="brine-lede">You've answered {Object.keys(s.answers).length} so far. We'll pick up where you left off.</p>
        )}
        <Chapters view={view} walk={walk} onPick={null} />
        <div className="brine-row">
          <button type="button" className="brine-key brine-accent" onClick={() => setStarted(true)} autoFocus>
            {fresh ? "Begin" : "Keep going"} →
          </button>
        </div>
      </section>,
    )

  if (s.at === END)
    return shell(
      <section className="brine-welcome">
        <p className="brine-label">All done</p>
        <h1>{interview.farewell.heading.replace("{name}", first)}</h1>
        {interview.farewell.body.split(/\n\n+/).map((p, i) => <p key={i} className="brine-lede">{p}</p>)}
        <div className="brine-row">
          <button type="button" className="brine-key" onClick={() => run(call<View>(code!, "back", { method: "POST" })).catch(() => {})}>← Change your last answer</button>
        </div>
      </section>,
    )

  if (contents)
    return shell(
      <section>
        <h1>Chapters</h1>
        <p className="brine-soft">Jump to any chapter. Your answers stay where they are, and Back always retraces your steps.</p>
        <Chapters view={view} walk={walk} onPick={(id) => run(call<View>(code!, "jump", { method: "POST", body: JSON.stringify({ chapter: id }) })).then(() => setContents(false), () => {})} />
      </section>,
    )

  return shell(<Ask key={s.at} code={code!} walk={walk} view={view} error={error} run={run} />)
}

function Chapters({ view, walk, onPick }: { view: View; walk: ReturnType<typeof compile>; onPick: ((id: string) => void) | null }) {
  const here = walk.byId.get(view.session.at)?.chapter.id
  const rows = view.progress.filter((c) => c.total > 0)
  // Consecutive chapters that share a part are listed under it, in the order of the process.
  const groups: { part?: string; rows: typeof rows }[] = []
  for (const c of rows) {
    const last = groups[groups.length - 1]
    if (last && last.part === c.part) last.rows.push(c)
    else groups.push({ part: c.part, rows: [c] })
  }
  let n = 0
  return (
    <div className="brine-chapters">
      {groups.map((g, gi) => (
        <section key={gi}>
          {g.part && <p className="brine-part">{g.part}</p>}
          <ol>
            {g.rows.map((c) => {
              const inner = (
                <>
                  <span className="brine-num">{String(++n).padStart(2, "0")}</span>
                  <span className="brine-grow">{c.title}</span>
                  <span className="brine-label">{c.answered >= c.total ? "done" : c.answered ? `${c.answered} of ${c.total}` : `${c.total}`}</span>
                </>
              )
              return (
                <li key={c.id} className={`${c.id === here ? "here" : ""} ${c.answered >= c.total ? "done" : ""}`}>
                  {onPick ? <button type="button" onClick={() => onPick(c.id)}>{inner}</button> : <div>{inner}</div>}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

interface Draft {
  value?: Answer["value"]
  note?: string
  voice: Recorded[]
  noteOpen?: boolean
}

function Ask({ code, walk, view, error, run }: { code: string; walk: ReturnType<typeof compile>; view: View; error: string | null; run: (p: Promise<View>) => Promise<void> }) {
  const s = view.session
  const node = walk.byId.get(s.at)!
  const q = node.question
  const chapters = view.progress.filter((c) => c.total > 0)
  const ci = chapters.findIndex((c) => c.id === node.chapter.id)
  const chapterFirst = !s.path.some((p) => p.startsWith(`${node.chapter.id}/`))
  const draftKey = `draft.${code.slice(0, 6)}.${s.at}`
  const prior = s.answers[s.at]
  const [draft, setDraftState] = useState<Draft>(() =>
    local.get<Draft>(draftKey, { value: prior?.value ?? (q.kind === "multi" ? [] : undefined), note: prior?.note, voice: (prior?.voice ?? []).map((id) => ({ id, seconds: 0 })), noteOpen: Boolean(prior?.note || prior?.voice?.length) }),
  )
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const setDraft = (fn: (d: Draft) => Draft) =>
    setDraftState((d) => {
      const next = fn(d)
      local.set(draftKey, next)
      return next
    })

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const hasValue = Array.isArray(draft.value) ? draft.value.length > 0 : draft.value !== undefined && String(draft.value).trim() !== ""
  const hasAnything = hasValue || Boolean(draft.note?.trim()) || draft.voice.length > 0
  const talks = Boolean(q.decide) && draft.voice.length > 0

  const submit = async (skip = false) => {
    if (busy || recording) return
    setBusy(true)
    try {
      await run(
        call<View>(code, "answer", {
          method: "POST",
          body: JSON.stringify(skip ? { q: s.at, skipped: true } : { q: s.at, value: draft.value, note: draft.note, voice: draft.voice.map((v) => v.id) }),
        }),
      )
      local.set(draftKey, undefined)
    } catch {
      setBusy(false)
    }
  }
  const back = async () => {
    if (busy || !s.path.length) return
    setBusy(true)
    await run(call<View>(code, "back", { method: "POST" })).catch(() => setBusy(false))
  }

  const upload = async (blob: Blob, seconds: number) => {
    const r = await call<Recorded>(code, `voice?q=${encodeURIComponent(s.at)}&seconds=${seconds}`, { method: "POST", body: blob, headers: { "content-type": blob.type || "audio/webm" } })
    return { id: r.id, seconds }
  }
  const forget = (id: string) => {
    setDraft((d) => ({ ...d, voice: d.voice.filter((v) => v.id !== id) }))
    call(code, `voice/${id}`, { method: "DELETE" }).catch(() => {})
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (q.kind !== "long" || e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault()
      submit(!hasAnything)
    }
  }

  // Number keys pick options on choice and scale questions.
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
            <button type="button" aria-label="Remove recording" onClick={() => forget(v.id)}>×</button>
          </span>
        ))}
        <span className="brine-grow" />
        <Recorder upload={upload} onBusy={setRecording} onRecorded={(r) => setDraft((d) => ({ ...d, voice: [...d.voice, r] }))} />
      </div>
    </div>
  )

  return (
    <section className="brine-question">
      <div className="brine-ticks" aria-label={`Chapter ${ci + 1} of ${chapters.length}`}>
        {chapters.map((c, i) => (
          <span key={c.id} title={c.title} className={`${i < ci ? "done" : ""} ${i === ci ? "now" : ""}`} />
        ))}
      </div>
      <p className="brine-label">
        {node.chapter.part ? `${node.chapter.part} · ` : ""}
        {String(ci + 1).padStart(2, "0")} {node.chapter.title}
      </p>
      {chapterFirst && node.chapter.lede && <p className="brine-lede">{node.chapter.lede}</p>}
      <h1>{q.ask}</h1>
      {q.hint && <p className="brine-soft">{q.hint}</p>}

      {q.kind === "long" && box("Type here, or press the waveform and just talk.", "value")}

      {q.kind === "text" && <input ref={input} className="brine-well" aria-label={q.ask} value={(draft.value as string) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} onKeyDown={onKey} />}

      {q.kind === "number" && (
        <div className="brine-number">
          <input ref={input} className="brine-well" type="number" inputMode="decimal" aria-label={q.ask} value={(draft.value as number | undefined) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value === "" ? undefined : Number(e.target.value) }))} onKeyDown={onKey} />
          {q.unit && <span className="brine-soft">{q.unit}</span>}
        </div>
      )}

      {(q.kind === "choice" || q.kind === "multi") && (
        <div className={q.kind === "choice" ? "brine-choices" : "brine-chips"} role={q.kind === "choice" ? "radiogroup" : "group"}>
          {q.options!.map((o, i) => {
            const on = q.kind === "multi" ? ((draft.value as string[] | undefined) ?? []).includes(o.value) : draft.value === o.value
            return (
              <button
                key={o.value}
                type="button"
                role={q.kind === "choice" ? "radio" : "checkbox"}
                aria-checked={on}
                className={`brine-option ${on ? "on" : ""}`}
                onClick={() => setDraft((d) => (q.kind === "multi" ? { ...d, value: toggle(d.value as string[] | undefined, o.value) } : { ...d, value: o.value }))}
              >
                {i < 9 && <span className="brine-num">{i + 1}</span>}
                {o.label}
              </button>
            )
          })}
        </div>
      )}

      {q.kind === "scale" && (
        <div className="brine-scale" role="radiogroup">
          {q.scale!.map((label, i) => (
            <button key={i} type="button" role="radio" aria-checked={draft.value === String(i)} className={`brine-option ${draft.value === String(i) ? "on" : ""}`} onClick={() => setDraft((d) => ({ ...d, value: String(i) }))}>
              <span className="brine-num">{i + 1}</span>
              {label}
            </button>
          ))}
        </div>
      )}

      {q.kind !== "long" && (q.note || q.decide) && (draft.noteOpen ? box("Anything to add? Type or talk.", "note") : (
        <button type="button" className="brine-link brine-add" onClick={() => setDraft((d) => ({ ...d, noteOpen: true }))}>
          <WaveIcon size={16} /> Add a note, typed or spoken
        </button>
      ))}

      {error && <p className="brine-error" role="alert">{error}</p>}

      <div className="brine-row">
        <button type="button" className="brine-key" disabled={!s.path.length || busy} onClick={back}>← Back</button>
        <span className="brine-grow" />
        {!recording && <span className="brine-label brine-hint-key">{q.kind === "long" ? "⌘ enter" : "enter"}</span>}
        {hasAnything ? (
          <button type="button" className="brine-key brine-accent" disabled={busy || recording} onClick={() => submit()}>
            {busy ? (talks ? "Listening…" : "Saving…") : "Next →"}
          </button>
        ) : (
          <button type="button" className="brine-key" disabled={busy || recording} onClick={() => submit(true)}>
            {busy ? "Saving…" : "Skip →"}
          </button>
        )}
      </div>
    </section>
  )
}

const toggle = (xs: string[] | undefined, v: string) => ((xs ?? []).includes(v) ? (xs ?? []).filter((x) => x !== v) : [...(xs ?? []), v])

export type { Question }
