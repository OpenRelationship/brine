// The waveform button in the answer box. Press it and talk; the live waveform shows it is
// listening. Stop, and the recording goes to the server, which transcribes it. The respondent
// never sees the transcript: the answer box only shows that a recording is attached.

import { useEffect, useRef, useState } from "react"

const LIMIT = 20 * 60 // seconds; the Worker takes up to 25 MB

export interface Recorded {
  id: string
  seconds: number
}

type Phase = { kind: "idle" } | { kind: "asking" } | { kind: "live"; started: number } | { kind: "sending" } | { kind: "failed"; blob: Blob; seconds: number; why: string }

export function WaveIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4M23 11v2" />
    </svg>
  )
}

function mimeType() {
  if (typeof MediaRecorder === "undefined") return null
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"]) if (MediaRecorder.isTypeSupported(t)) return t
  return ""
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export function Recorder({ upload, onRecorded, onBusy }: { upload: (blob: Blob, seconds: number) => Promise<Recorded>; onRecorded: (r: Recorded) => void; onBusy?: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [elapsed, setElapsed] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; chunks: Blob[]; cancel: boolean } | null>(null)
  const supported = mimeType() !== null && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => onBusy?.(phase.kind === "live" || phase.kind === "sending" || phase.kind === "asking"), [phase.kind])
  useEffect(() => () => stopAll(), [])

  function stopAll() {
    const l = live.current
    if (!l) return
    cancelAnimationFrame(l.raf)
    l.stream.getTracks().forEach((t) => t.stop())
    l.ctx.close().catch(() => {})
    live.current = null
  }

  async function send(blob: Blob, seconds: number) {
    setPhase({ kind: "sending" })
    try {
      onRecorded(await upload(blob, seconds))
      setPhase({ kind: "idle" })
    } catch (e) {
      setPhase({ kind: "failed", blob, seconds, why: (e as Error).message || "The recording didn't upload." })
    }
  }

  async function start() {
    setPhase({ kind: "asking" })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setPhase({ kind: "failed", blob: new Blob(), seconds: 0, why: "The microphone is blocked. Allow it in the browser's address bar, then try again." })
      return
    }
    const type = mimeType() || undefined
    const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined)
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const chunks: Blob[] = []
    const started = performance.now()
    live.current = { rec, stream, ctx, raf: 0, chunks, cancel: false }
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const cancelled = live.current?.cancel
      const seconds = Math.round((performance.now() - started) / 1000)
      stopAll()
      if (cancelled || !chunks.length) return setPhase({ kind: "idle" })
      send(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }), seconds)
    }
    rec.start(1000)
    setElapsed(0)
    setPhase({ kind: "live", started })

    // The live waveform: the last few seconds of loudness, drawn as bars that scroll left.
    const data = new Uint8Array(analyser.fftSize)
    const levels: number[] = []
    let last = 0
    const draw = (t: number) => {
      const l = live.current
      if (!l) return
      l.raf = requestAnimationFrame(draw)
      const secs = (t - started) / 1000
      setElapsed(secs)
      if (secs >= LIMIT && l.rec.state === "recording") l.rec.stop()
      if (t - last < 50) return
      last = t
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
      levels.push(Math.min(1, peak * 1.8))
      const c = canvas.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr) (c.width = w * dpr), (c.height = h * dpr)
      const g = c.getContext("2d")!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = getComputedStyle(c).color
      const bar = 3
      const gap = 2
      const n = Math.floor(w / (bar + gap))
      const shown = levels.slice(-n)
      shown.forEach((v, i) => {
        const bh = Math.max(2, v * h)
        g.beginPath()
        g.roundRect(w - (shown.length - i) * (bar + gap), (h - bh) / 2, bar, bh, 1.5)
        g.fill()
      })
    }
    live.current.raf = requestAnimationFrame(draw)
  }

  const stop = (cancel = false) => {
    const l = live.current
    if (!l) return
    l.cancel = cancel
    if (l.rec.state === "recording") l.rec.stop()
  }

  if (!supported) return null

  if (phase.kind === "live")
    return (
      <div className="brine-rec live" role="group" aria-label="Recording">
        <span className="brine-rec-dot" aria-hidden="true" />
        <canvas ref={canvas} className="brine-rec-wave" aria-hidden="true" />
        <span className="brine-rec-time" aria-live="off">{clock(elapsed)}</span>
        <button type="button" className="brine-link" onClick={() => stop(true)}>Discard</button>
        <button type="button" className="brine-key brine-accent small" onClick={() => stop()}>Done</button>
      </div>
    )

  if (phase.kind === "sending") return <div className="brine-rec"><span className="brine-soft">Saving your recording…</span></div>

  if (phase.kind === "failed")
    return (
      <div className="brine-rec failed" role="alert">
        <span className="brine-soft">{phase.why}</span>
        {phase.blob.size > 0 && <button type="button" className="brine-link" onClick={() => send(phase.blob, phase.seconds)}>Try again</button>}
        <button type="button" className="brine-link" onClick={() => setPhase({ kind: "idle" })}>Dismiss</button>
      </div>
    )

  return (
    <button type="button" className="brine-mic" onClick={start} disabled={phase.kind === "asking"} title="Answer out loud" aria-label="Record your answer">
      <WaveIcon />
    </button>
  )
}
