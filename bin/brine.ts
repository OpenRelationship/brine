#!/usr/bin/env bun
// brine — the designer's side of an interview.
//
//   brine check <interview.ts>            lint the question tree and print its size
//   brine outline <interview.ts>          every question with its guard, why and yields (markdown)
//   brine invite <url> <name>             make an invite link              (BRINE_ADMIN_TOKEN)
//   brine passcode <url> <code> <passcode>  let that respondent in by typing a passcode on the site
//   brine status <url>                    who is how far                    (BRINE_ADMIN_TOKEN)
//   brine export <url> [dir]              answers.json + answers.md         (BRINE_ADMIN_TOKEN)
//   brine transcribe <url>                retry every recording without a transcript
//   brine revoke <url> <code>             delete an invite, its answers and its recordings
//   brine trace <interview.ts> <answers.json> <feature>...   @q: tags resolve; answers no scenario cites
//   brine followup <id> <title> <feature>...                  draft round two (read-backs + TODOs) as TS
//   brine ledger check <interview.ts> <ledger.json> [answers.json]  every fact typed and cited; answers no fact cites
//   brine ledger render <ledger.json> [kind...]                     the facts as markdown, by kind
//   brine ledger emit <ledger.json> [kind...]                       the facts as a typed TS module for code
//   brine ledger records <answers.json> <ledger.json|-> <feature>...  one JSONL retrieval record per answer
//
// <interview.ts> exports `interview` (or a default). answers.md is what the Gherkin pass reads.

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { check } from "../src/check"
import { followup, scan, source, trace } from "../src/loop"
import { answerRecords, checkLedger, emitLedger, KINDS, renderLedger, type FactKind, type Ledger } from "../src/ledger"
import type { Condition, Interview } from "../src/spec"

const [cmd, ...args] = process.argv.slice(2)

async function load(file: string): Promise<Interview> {
  const mod = await import(path.resolve(file))
  const i = mod.interview ?? mod.default
  if (!i?.chapters) throw new Error(`${file} does not export an interview`)
  return i
}

function admin(base: string) {
  const token = process.env.BRINE_ADMIN_TOKEN
  if (!token) throw new Error("Set BRINE_ADMIN_TOKEN (the Worker's admin secret).")
  const root = base.replace(/\/+$/, "")
  return async <T,>(p: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${root}/api/admin/${p}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${(body as { error?: string }).error ?? res.statusText}`)
    return body as T
  }
}

function describe(c: Condition | undefined): string {
  if (!c) return ""
  if ("all" in c) return c.all.map(describe).join(" and ")
  if ("any" in c) return `(${c.any.map(describe).join(" or ")})`
  if ("none" in c) return `not (${c.none.map(describe).join(" or ")})`
  if ("decision" in c) return `${c.q}.${c.decision} is ${[c.is].flat().join("|")}`
  if ("answered" in c) return `${c.q} ${c.answered ? "answered" : "not answered"}`
  if ("atLeast" in c) return `${c.q} ≥ ${c.atLeast}`
  if ("is" in c) return `${c.q} is ${[c.is].flat().join("|")}`
  return `${c.q} is not ${[c.not].flat().join("|")}`
}

async function main() {
  if (cmd === "check") {
    const r = check(await load(args[0]))
    for (const e of r.errors) console.log(`ERROR  ${e}`)
    for (const w of r.warnings) console.log(`warn   ${w}`)
    const s = r.stats
    console.log(`\n${s.chapters} chapters, ${s.questions} questions (${s.always} always, ${s.conditional} conditional), ${s.decisions} decisions`)
    if (!r.errors.length) console.log(`a walk asks ${s.walks.min}–${s.walks.max}, median ${s.walks.median} (sampled)`)
    for (const c of s.byChapter) console.log(`  ${c.id.padEnd(16)} ${String(c.questions).padStart(3)}  ${c.conditional ? `(${c.conditional} conditional)  ` : ""}${c.title}`)
    process.exit(r.errors.length ? 1 : 0)
  }

  if (cmd === "outline") {
    const i = await load(args[0])
    const out = [`# ${i.title}`, ""]
    i.chapters.forEach((c, ci) => {
      out.push(`## ${ci + 1}. ${c.title} \`${c.id}\``, "")
      if (c.lede) out.push(`> ${c.lede}`, "")
      if (c.when) out.push(`_only when ${describe(c.when)}_`, "")
      c.questions.forEach((q, qi) => {
        out.push(`${qi + 1}. **${q.ask}** \`${q.id}\` · ${q.kind}${q.when ? ` · _when ${describe(q.when)}_` : ""}`)
        if (q.context) out.push(`   - context: ${[q.context].flat().join(" · ")}`)
        if (q.hint) out.push(`   - ways to think about it: ${[q.hint].flat().join(" · ")}`)
        if (q.options) out.push(`   - options: ${q.options.map((o) => `${o.label}${o.next ? ` → ${o.next}` : ""}`).join(" · ")}`)
        if (q.scale) out.push(`   - scale: ${q.scale.join(" · ")}`)
        if (q.decide) out.push(`   - Jev: ${Object.entries(q.decide).map(([k, d]) => `${k} (${d.type})`).join(", ")}`)
        out.push(`   - why: ${q.why}`, `   - yields: ${q.yields}`)
      })
      out.push("")
    })
    console.log(out.join("\n"))
    return
  }

  if (cmd === "trace") {
    const [file, answersFile, ...features] = args
    const i = await load(file)
    const scans = await Promise.all(features.map(async (f) => scan(await Bun.file(f).text(), f)))
    const exp = answersFile && answersFile !== "-" ? await Bun.file(answersFile).json() : { people: [] }
    const answered: string[] = exp.people.flatMap((p: { answers: { id: string; skipped: boolean; applies: boolean }[] }) => p.answers.filter((a) => !a.skipped && a.applies).map((a) => a.id))
    const t = trace(i, scans, [...new Set(answered)])
    const scenarios = scans.reduce((n, s) => n + s.scenarios.length, 0)
    console.log(`${scenarios} scenarios in ${scans.length} features cite ${Object.keys(t.cited).length} questions; ${t.untagged.length} scenarios have no @q: tag`)
    for (const u of t.unknown) console.log(`UNKNOWN  ${u.path}:${u.line}  @q:${u.id}`)
    for (const u of t.untagged) console.log(`untagged ${u.path}:${u.line}  ${u.name}`)
    if (answered.length) console.log(`${t.uncited.length} answered questions no scenario cites:\n${t.uncited.map((x) => `  ${x}`).join("\n")}`)
    process.exit(t.unknown.length ? 1 : 0)
  }

  if (cmd === "followup") {
    const [id, title, ...features] = args
    const scans = await Promise.all(features.map(async (f) => scan(await Bun.file(f).text(), f)))
    const f = followup(scans, { id, title })
    const n = f.interview.chapters.reduce((k, c) => k + c.questions.length, 0)
    console.log(source(f.interview))
    console.error(`${f.interview.chapters.length} chapters, ${n} draft questions. Conflicts are rulings for the owner, not questions:`)
    for (const c of f.conflicts) console.error(`  ${c.path}:${c.line}  ${c.text}`)
    return
  }

  if (cmd === "ledger") {
    const [sub, ...rest] = args
    if (sub === "check") {
      const [file, ledgerFile, answersFile] = rest
      const i = await load(file)
      const ledger = (await Bun.file(ledgerFile).json()) as Ledger
      const exp = answersFile ? await Bun.file(answersFile).json() : { people: [] }
      const answered: string[] = exp.people.flatMap((p: { answers: { id: string; skipped: boolean; applies: boolean }[] }) => p.answers.filter((a) => !a.skipped && a.applies).map((a) => a.id))
      const r = checkLedger(ledger, i, [...new Set(answered)])
      for (const e of r.errors) console.log(`ERROR  ${e}`)
      for (const w of r.warnings) console.log(`warn   ${w}`)
      console.log(`${ledger.facts.length} facts: ${Object.entries(r.byKind).map(([k, n]) => `${n} ${k}`).join(", ")}`)
      console.log(`status: ${Object.entries(r.byStatus).map(([k, n]) => `${n} ${k}`).join(", ")}`)
      if (answersFile) console.log(`${r.uncited.length} answered questions no fact cites${r.uncited.length ? ` (fine when a scenario covers them): ${r.uncited.join(" ")}` : ""}`)
      process.exit(r.errors.length ? 1 : 0)
    }
    if (sub === "render") {
      const [ledgerFile, ...kinds] = rest
      const bad = kinds.filter((k) => !(KINDS as readonly string[]).includes(k))
      if (bad.length) throw new Error(`unknown kind ${bad.join(", ")}; kinds are ${KINDS.join(", ")}`)
      console.log(renderLedger((await Bun.file(ledgerFile).json()) as Ledger, kinds.length ? (kinds as FactKind[]) : undefined))
      return
    }
    if (sub === "emit") {
      const [ledgerFile, ...kinds] = rest
      const bad = kinds.filter((k) => !(KINDS as readonly string[]).includes(k))
      if (bad.length) throw new Error(`unknown kind ${bad.join(", ")}`)
      process.stdout.write(emitLedger((await Bun.file(ledgerFile).json()) as Ledger, ledgerFile, kinds.length ? (kinds as FactKind[]) : undefined))
      return
    }
    if (sub === "records") {
      // brine ledger records <answers.json> <ledger.json|-> <features…>: JSONL, one record per answer
      const [answersFile, ledgerFile, ...features] = rest
      const exp = await Bun.file(answersFile).json()
      const ledger = ledgerFile && ledgerFile !== "-" ? ((await Bun.file(ledgerFile).json()) as Ledger) : undefined
      const scans = await Promise.all(features.map(async (f) => scan(await Bun.file(f).text(), f)))
      const rs = answerRecords(exp, scans, ledger)
      for (const r of rs) console.log(JSON.stringify(r))
      const bare = rs.filter((r) => !r.scenarios.length && !r.facts.length)
      console.error(`${rs.length} records; ${bare.length} cited by no scenario or fact${bare.length ? `: ${bare.map((r) => r.id).join(" ")}` : ""}`)
      return
    }
    throw new Error("brine ledger check|render|emit|records")
  }

  if (cmd === "invite") {
    const [url, ...name] = args
    const r = await admin(url)<{ link: string; name: string }>("invite", { method: "POST", body: JSON.stringify({ name: name.join(" ") }) })
    console.log(`${r.name}: ${r.link}`)
    return
  }

  if (cmd === "passcode") {
    const [url, code, ...words] = args
    const r = await admin(url)<{ name: string; entry: string }>("passcode", { method: "POST", body: JSON.stringify({ code, passcode: words.join(" ") }) })
    console.log(`${r.name}: open ${r.entry} and type the passcode`)
    return
  }

  if (cmd === "status") {
    const rows = await admin(args[0])<{ code: string; name: string; answered: number; at: string | null; finished: string | null; created: string }[]>("invites")
    for (const r of rows) console.log(`${r.code}  ${r.name.padEnd(24)} ${String(r.answered).padStart(4)} answered  ${r.finished ? `finished ${r.finished.slice(0, 10)}` : r.at ? `at ${r.at}` : ""}`)
    return
  }

  if (cmd === "transcribe") {
    const rows = await admin(args[0])<{ id: string; ok: boolean; error?: string }[]>("transcribe", { method: "POST", body: "{}" })
    console.log(`${rows.filter((r) => r.ok).length} of ${rows.length} transcribed`)
    for (const r of rows.filter((r) => !r.ok)) console.log(`  ${r.id}: ${r.error}`)
    return
  }

  if (cmd === "revoke") {
    const r = await admin(args[0])<{ revoked: string; recordings: number }>(`invite/${args[1]}`, { method: "DELETE" })
    console.log(`revoked ${r.revoked}: invite, answers and ${r.recordings} recordings deleted`)
    return
  }

  if (cmd === "export") {
    const [url, dir = ".brine"] = args
    type Row = { id: string; chapter: string; ask: string; kind: string; why: string; yields: string; skipped: boolean; value?: unknown; label?: string | string[]; note?: string; recordings: { seconds: number; transcript: string | null; error?: string }[]; decisions: Record<string, string> }
    const ex = await admin(url)<{ interview: { id: string; title: string; glossary: Record<string, string> }; exported: string; people: { name: string; finished: string | null; at: string | null; answers: Row[] }[] }>("export")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "answers.json"), JSON.stringify(ex, null, 2))
    const md = [`# ${ex.interview.title}: answers`, "", `Exported ${ex.exported}. Each answer carries the question's why (what it was really after) and yields (where it lands in the Gherkin). Transcripts are verbatim speech; treat them as the respondent's own words.`, ""]
    if (Object.keys(ex.interview.glossary).length) {
      md.push("## Glossary", "")
      for (const [k, v] of Object.entries(ex.interview.glossary)) md.push(`- **${k}**: ${v}`)
      md.push("")
    }
    for (const p of ex.people) {
      md.push(`# ${p.name}`, "", p.finished ? `Finished ${p.finished}.` : `Not finished; currently at ${p.at ?? "the start"}.`, "")
      let chapter = ""
      for (const a of p.answers) {
        if (a.chapter !== chapter) md.push(`## ${(chapter = a.chapter)}`, "")
        md.push(`### ${a.ask}`, `\`${a.id}\` · why: ${a.why} · yields: ${a.yields}`, "")
        if (a.skipped) md.push("_skipped_", "")
        else {
          const said: string[] = []
          if (a.label !== undefined) said.push(`**${[a.label].flat().join(", ")}**`)
          else if (a.value !== undefined && String(a.value).trim()) said.push(String(a.value))
          if (a.note) said.push(a.note)
          a.recordings.forEach((r, i) => said.push(r.transcript != null ? `🎙 ${r.transcript}` : `🎙 _recording ${i + 1} (${r.seconds}s) not transcribed${r.error ? `: ${r.error}` : ""}_`))
          md.push(said.join("\n\n") || "_nothing_", "")
          if (Object.keys(a.decisions).length) md.push(`_Jev read it as: ${Object.entries(a.decisions).map(([k, v]) => `${k} = ${v}`).join(", ")}_`, "")
        }
      }
    }
    await writeFile(path.join(dir, "answers.md"), md.join("\n"))
    const n = ex.people.reduce((k, p) => k + p.answers.length, 0)
    console.log(`${ex.people.length} respondents, ${n} answers -> ${dir}/answers.json, ${dir}/answers.md`)
    return
  }

  console.log(`brine check <interview.ts> | outline <interview.ts> | trace | followup | ledger check|render|emit|records | invite <url> <name> | passcode <url> <code> <passcode> | status <url> | export <url> [dir] | transcribe <url> | revoke <url> <code>`)
  process.exit(cmd ? 2 : 0)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
