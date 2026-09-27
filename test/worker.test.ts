import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { interview } from "../example/src/interview"
import { brine, type Env } from "../src/worker"

// In-memory stand-ins for the two bindings.
function kv() {
  const m = new Map<string, string>()
  return {
    m,
    async get(k: string, type?: string) {
      const v = m.get(k)
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v
    },
    async put(k: string, v: string) {
      m.set(k, v)
    },
    async delete(k: string) {
      m.delete(k)
    },
    async list({ prefix }: { prefix: string }) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }
    },
  }
}
function r2() {
  const m = new Map<string, { body: ArrayBuffer; type: string }>()
  return {
    m,
    async put(k: string, body: ArrayBuffer | string, o: { httpMetadata: { contentType: string } }) {
      m.set(k, { body: typeof body === "string" ? (new TextEncoder().encode(body).buffer as ArrayBuffer) : body, type: o.httpMetadata.contentType })
    },
    async get(k: string) {
      const v = m.get(k)
      return v ? { body: new Blob([v.body]).stream(), arrayBuffer: async () => v.body, text: async () => new TextDecoder().decode(v.body as any) } : null
    },
    async delete(k: string) {
      m.delete(k)
    },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }
    },
  }
}

const realFetch = globalThis.fetch
let calls: { url: string; body: unknown }[] = []
let waits: Promise<unknown>[] = []
const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext

let env: Env
const app = brine(interview)
const req = (path: string, init: RequestInit & { token?: string } = {}) =>
  app.fetch(new Request(`https://x.test${path}`, { ...init, headers: { ...(init.token && { authorization: `Bearer ${init.token}` }), ...(init.body && typeof init.body === "string" && { "content-type": "application/json" }), ...init.headers } }), env, ctx)

beforeEach(() => {
  calls = []
  waits = []
  env = { BRINE: kv() as unknown as KVNamespace, BRINE_AUDIO: r2() as unknown as R2Bucket, OPENROUTER_API_KEY: "k", BRINE_ADMIN_TOKEN: "admin" }
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith("/audio/transcriptions")) {
      calls.push({ url: u, body: (init!.body as FormData).get("model") })
      return Response.json({ text: "Unless it's a rush order, then Pat drives it." })
    }
    if (u.endsWith("/alpha/decisions")) {
      const body = JSON.parse(String(init!.body))
      calls.push({ url: u, body })
      return Response.json({ answers: { exception: { type: "noul", noul: body.state.answer.includes("Unless") ? 0.97 : 0.03 } } })
    }
    return realFetch(url as string, init)
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

async function invite() {
  const res = await req("/api/admin/invite", { method: "POST", token: "admin", body: JSON.stringify({ name: "Sam Baker" }) })
  return ((await res.json()) as { code: string; link: string }).code
}

describe("worker", () => {
  test("no invite, no entry", async () => {
    expect((await req("/api/session")).status).toBe(401)
    expect((await req("/api/session", { token: "nope" })).status).toBe(401)
    expect((await req("/api/admin/export", { token: "wrong" })).status).toBe(401)
  })

  test("a voice answer is stored, transcribed, and read by Jev to branch", async () => {
    const code = await invite()
    let r = (await (await req("/api/session", { token: code })).json()) as any
    expect(r.respondent).toBe("Sam Baker")
    expect(r.session.at).toBe("orders/sources")

    r = await (await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["wholesale"] }) })).json()
    expect(r.session.at).toBe("orders/wholesale")

    const up = await req("/api/voice?q=orders/wholesale&seconds=12", { method: "POST", token: code, body: new Uint8Array([1, 2, 3]), headers: { "content-type": "audio/webm;codecs=opus" } })
    const { id } = (await up.json()) as { id: string }
    await Promise.all(waits)

    r = await (await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/wholesale", voice: [id] }) })).json()
    expect(r.session.decisions["orders/wholesale.exception"]).toBe("yes")
    expect(r.session.at).toBe("orders/wholesale_exception")
    expect(calls.filter((c) => c.url.endsWith("/audio/transcriptions"))[0].body).toBe("openai/gpt-4o-mini-transcribe")
    const decision = calls.find((c) => c.url.endsWith("/alpha/decisions"))!.body as any
    expect(decision.model).toBe("typesafe/jev-1.13")
    expect(decision.state.answer).toContain("rush order")

    await Promise.all(waits)
    const ex = (await (await req("/api/admin/export", { token: "admin" })).json()) as any
    const a = ex.people[0].answers.find((x: any) => x.id === "orders/wholesale")
    expect(a.recordings[0].transcript).toContain("Pat drives it")
    expect(a.decisions).toEqual({ exception: "yes" })
    expect(a.why).toBeString()
    expect(a.yields).toBeString()
  })

  test("without a key the branch falls back to asking more", async () => {
    env.OPENROUTER_API_KEY = undefined
    const code = await invite()
    await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["wholesale"] }) })
    const r = (await (await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/wholesale", value: "Always the same." }) })).json()) as any
    expect(r.session.at).toBe("orders/wholesale_exception")
  })

  test("an answer to a question that is no longer current is refused with the current walk", async () => {
    const code = await invite()
    const res = await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "bake/plan", value: "x" }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as any).session.at).toBe("orders/sources")
  })

  test("removing a recording from the box keeps the audio, marked dropped, in the export", async () => {
    const code = await invite()
    const up = async () => ((await (await req("/api/voice?q=orders/sources", { method: "POST", token: code, body: new Uint8Array([1]), headers: { "content-type": "audio/mp4" } })).json()) as { id: string }).id
    const a = await up()
    expect((await (await req(`/api/voice/${a}`, { method: "DELETE", token: code })).json()) as object).toEqual({ dropped: true })
    expect([...(env.BRINE_AUDIO as any).m.keys()].some((k: string) => k.endsWith(a))).toBeTrue()
    await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["phone"] }) })
    await Promise.all(waits)
    const ex = (await (await req("/api/admin/export", { token: "admin" })).json()) as any
    expect(ex.people[0].dropped.map((r: any) => r.id)).toEqual([a])
  })

  test("every answer and edit is appended to the log, never overwritten", async () => {
    const code = await invite()
    const post = (path: string, body: object) => req(path, { method: "POST", token: code, body: JSON.stringify(body) })
    await post("/api/answer", { q: "orders/sources", value: ["walkin"] })
    await post("/api/save", { q: "orders/cutoff", value: "yes" })
    await post("/api/goto", { q: "orders/sources" })
    await post("/api/save", { q: "orders/sources", value: ["walkin", "wholesale"] })
    const log = (await (await req(`/api/admin/log/${code}`, { token: "admin" })).json()) as any[]
    expect(log.map((e) => [e.kind, e.q, e.answer.value])).toEqual([
      ["answer", "orders/sources", ["walkin"]],
      ["save", "orders/cutoff", "yes"],
      ["save", "orders/sources", ["walkin", "wholesale"]],
    ])
  })

  test("revoking an invite deletes its walk and recordings", async () => {
    const code = await invite()
    await req("/api/voice?q=orders/sources", { method: "POST", token: code, body: new Uint8Array([1]), headers: { "content-type": "audio/webm" } })
    await Promise.all(waits)
    const r = (await (await req(`/api/admin/invite/${code}`, { method: "DELETE", token: "admin" })).json()) as any
    expect(r.recordings).toBe(1)
    expect((await req("/api/session", { token: code })).status).toBe(401)
    expect([...(env.BRINE as any).m.keys()]).toEqual([])
    expect((env.BRINE_AUDIO as any).m.size).toBe(0)
  })

  test("save keeps an answer without moving; goto and resume move around the walk", async () => {
    const code = await invite()
    const post = async (path: string, body: object) => (await (await req(path, { method: "POST", token: code, body: JSON.stringify(body) })).json()) as any
    let r = await post("/api/answer", { q: "orders/sources", value: ["walkin"] })
    expect(r.session.at).toBe("orders/cutoff")
    // Leave the question half-typed: it is saved, and the screen stays put.
    r = await post("/api/save", { q: "orders/cutoff", value: "yes", note: "after 4pm" })
    expect(r.session.at).toBe("orders/cutoff")
    expect(r.frontier).toBe("orders/cutoff_time")
    // Open the first answer, add wholesale: the follow-up it opens becomes where they left off.
    r = await post("/api/goto", { q: "orders/sources" })
    expect(r.session.at).toBe("orders/sources")
    r = await post("/api/save", { q: "orders/sources", value: ["walkin", "wholesale"] })
    expect(r.frontier).toBe("orders/wholesale")
    r = await post("/api/resume", {})
    expect(r.session.at).toBe("orders/wholesale")
    // A question that does not apply cannot be saved into.
    const bad = await req("/api/save", { method: "POST", token: code, body: JSON.stringify({ q: "nope/x", value: "x" }) })
    expect(bad.status).toBe(409)
    const ex = (await (await req("/api/admin/export", { token: "admin" })).json()) as any
    expect(ex.people[0].leftOff).toBe("orders/wholesale")
    expect(ex.people[0].answers.find((a: any) => a.id === "orders/cutoff").note).toBe("after 4pm")
  })

  test("a passcode typed on the site trades for the invite", async () => {
    const code = await invite()
    const set = await req("/api/admin/passcode", { method: "POST", token: "admin", body: JSON.stringify({ code, passcode: "4827-19" }) })
    expect(set.status).toBe(200)
    const ok = (await (await req("/api/enter", { method: "POST", body: JSON.stringify({ passcode: " 482719 " }) })).json()) as any
    expect(ok.code).toBe(code)
    expect((await req("/api/enter", { method: "POST", body: JSON.stringify({ passcode: "000000" }) })).status).toBe(401)
    // Changing it retires the old one; revoking removes it.
    await req("/api/admin/passcode", { method: "POST", token: "admin", body: JSON.stringify({ code, passcode: "tacoma-nurse" }) })
    expect((await req("/api/enter", { method: "POST", body: JSON.stringify({ passcode: "482719" }) })).status).toBe(401)
    await req(`/api/admin/invite/${code}`, { method: "DELETE", token: "admin" })
    expect((await req("/api/enter", { method: "POST", body: JSON.stringify({ passcode: "tacoma-nurse" }) })).status).toBe(401)
  })

  test("passcode attempts are rate limited when a limiter is bound", async () => {
    env.BRINE_ENTER_LIMIT = { limit: async () => ({ success: false }) }
    expect((await req("/api/enter", { method: "POST", body: JSON.stringify({ passcode: "anything" }) })).status).toBe(429)
  })

  test("non-audio is refused", async () => {
    const code = await invite()
    const res = await req("/api/voice?q=orders/sources", { method: "POST", token: code, body: "hi", headers: { "content-type": "text/plain" } })
    expect(res.status).toBe(415)
  })
})

// The same Worker with walks in Durable Objects: a fake namespace that keeps one object per name.
describe("worker with Durable Object sessions", () => {
  function namespace() {
    const objects = new Map<string, { fetch(r: Request): Promise<Response> }>()
    const stores = new Map<string, Map<string, unknown>>()
    return {
      stores,
      idFromName: (name: string) => name,
      get(name: string) {
        if (!objects.has(name)) {
          const m = new Map<string, unknown>()
          stores.set(name, m)
          const state = {
            storage: { get: async (k: string) => structuredClone(m.get(k)), put: async (k: string, v: unknown) => void m.set(k, structuredClone(v)), deleteAll: async () => m.clear() },
            waitUntil: (p: Promise<unknown>) => waits.push(p),
          }
          objects.set(name, new app.BrineSession(state as unknown as DurableObjectState, env))
        }
        const o = objects.get(name)!
        return { fetch: (input: string | Request, init?: RequestInit) => o.fetch(typeof input === "string" ? new Request(input, init) : input) }
      },
    }
  }

  let ns: ReturnType<typeof namespace>
  beforeEach(() => {
    ns = namespace()
    env.BRINE_SESSIONS = ns as unknown as DurableObjectNamespace
  })

  test("the walk lives in the respondent's object, not KV", async () => {
    const code = await invite()
    await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["phone"] }) })
    expect(((ns.stores.get(code)!.get("session") as any).answers["orders/sources"].value)).toEqual(["phone"])
    expect([...(env.BRINE as any).m.keys()].some((k: string) => k.startsWith("session:"))).toBeFalse()
    const ex = (await (await req("/api/admin/export", { token: "admin" })).json()) as any
    expect(ex.people[0].answers[0].value).toEqual(["phone"])
  })

  test("saves sent at the same moment all land (no lost update)", async () => {
    const code = await invite()
    await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["walkin"] }) })
    // A phone and a laptop saving different questions at once.
    await Promise.all([
      req("/api/save", { method: "POST", token: code, body: JSON.stringify({ q: "orders/cutoff", value: "yes" }) }),
      req("/api/save", { method: "POST", token: code, body: JSON.stringify({ q: "bake/plan", value: "by the weather" }) }),
      req("/api/save", { method: "POST", token: code, body: JSON.stringify({ q: "bake/waste", value: 4 }) }),
    ])
    const s = (await (await req("/api/session", { token: code })).json()) as any
    expect(Object.keys(s.session.answers).sort()).toEqual(["bake/plan", "bake/waste", "orders/cutoff", "orders/sources"])
  })

  test("a double press answers once and does not skip a question", async () => {
    const code = await invite()
    const [a, b] = await Promise.all([
      req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["walkin"] }) }),
      req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["walkin"] }) }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const s = (await (await req("/api/session", { token: code })).json()) as any
    expect(s.session.at).toBe("orders/cutoff")
  })

  test("a walk saved in KV before the move is picked up, then kept in the object", async () => {
    const code = await invite()
    await env.BRINE.put(`session:${code}`, JSON.stringify({ at: "orders/cutoff", answers: { "orders/sources": { value: ["walkin"], at: "t" } }, decisions: {}, started: "t" }))
    const s = (await (await req("/api/session", { token: code })).json()) as any
    expect(s.session.at).toBe("orders/cutoff")
    expect((ns.stores.get(code)!.get("session") as any).answers["orders/sources"].value).toEqual(["walkin"])
  })

  test("revoking deletes the object's walk", async () => {
    const code = await invite()
    await req("/api/answer", { method: "POST", token: code, body: JSON.stringify({ q: "orders/sources", value: ["phone"] }) })
    await req(`/api/admin/invite/${code}`, { method: "DELETE", token: "admin" })
    expect(ns.stores.get(code)!.size).toBe(0)
  })
})
