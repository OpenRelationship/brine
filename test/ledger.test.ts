import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { checkLedger, emitLedger, fact, renderLedger, type Ledger } from "../src/ledger"

const ledger: Ledger = {
  interview: "bakery",
  respondent: "Sam",
  facts: [
    { id: "cutoff", kind: "timer", says: "Orders close the day before", value: 2, unit: "pm", after: "the day before delivery", then: "the order moves to the next day", sources: ["orders/cutoff"], status: "said" },
    { id: "wholesale-min", kind: "number", says: "Smallest wholesale order", value: 24, unit: "loaves", sources: ["orders/wholesale"], status: "said" },
    { id: "flour-risk", kind: "risk", says: "One flour supplier", severity: "high", mitigation: "a second mill", sources: ["orders/sources"], status: "said" },
    { id: "late-fee", kind: "number", says: "Late order fee", value: 5, unit: "USD", sources: [], status: "ruled", ruling: "owner, 2026-09-27" },
  ],
}

describe("ledger", () => {
  test("a sound ledger passes and counts by kind", () => {
    const r = checkLedger(ledger, interview, ["orders/cutoff", "orders/sources", "orders/wholesale", "orders/wholesale_exception"])
    expect(r.errors).toEqual([])
    expect(r.byKind).toEqual({ timer: 1, number: 2, risk: 1 })
    expect(r.uncited).toEqual(["orders/wholesale_exception"])
  })

  test("typing mistakes are errors", () => {
    const bad: Ledger = {
      ...ledger,
      facts: [
        { id: "No Caps", kind: "number", says: "x", sources: ["orders/nope"], status: "said" },
        { id: "t", kind: "timer", says: "x", value: 1, unit: "h", sources: ["orders/cutoff"], status: "said" },
        { id: "r", kind: "risk", says: "x", sources: ["orders/cutoff"], status: "ruled" },
        { id: "t", kind: "template", says: "x", sources: [], status: "said" },
      ],
    }
    const e = checkLedger(bad, interview).errors.join("\n")
    for (const want of ["id must be kebab-case", "not a question", "a number has a value and a unit", "a timer has a value, a unit, after and then", "a risk has a severity", "records its ruling", "duplicate id", "cites no answer", "a template has text"])
      expect(e).toContain(want)
  })

  test("code reads constants by id", () => {
    expect(fact(ledger, "wholesale-min").value).toBe(24)
    expect(() => fact(ledger, "missing")).toThrow()
  })

  test("render groups by kind, risks by severity", () => {
    const md = renderLedger(ledger)
    expect(md).toContain("## Timers")
    expect(md).toContain("**24 loaves** Smallest wholesale order")
    expect(renderLedger(ledger, ["risk"])).toContain("# Sam: Risks")
  })

  test("emit writes a typed module keyed by id, filtered by kind", () => {
    const ts = emitLedger(ledger, "ledger.json", ["number"])
    expect(ts).toContain("GENERATED")
    expect(ts).toContain('"wholesale-min"')
    expect(ts).not.toContain('"flour-risk"')
    expect(ts).toContain("export type FactId = keyof typeof FACTS")
  })
})
