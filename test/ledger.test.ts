import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { answerRecords, checkLedger, emitLedger, fact, renderLedger, type Ledger } from "../src/ledger"
import { scan } from "../src/loop"

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

describe("answer records", () => {
  test("one per live answer, with the respondent's words and what cites it", () => {
    const feature = `@q:orders/sources\nFeature: Orders\n\n  @q:orders/cutoff\n  Scenario: a late order\n    Given an order at 3pm\n`
    const exp = {
      people: [
        {
          name: "Sam",
          answers: [
            { id: "orders/cutoff", chapter: "Orders", ask: "When do orders close?", skipped: false, applies: true, value: "2pm", note: "the day before", recordings: [{ transcript: "two, the day before" }] },
            { id: "orders/sources", chapter: "Orders", ask: "Where do orders come from?", skipped: false, applies: true, recordings: [] },
            { id: "orders/wholesale", chapter: "Orders", ask: "Wholesale?", skipped: true, applies: true, recordings: [] },
            { id: "orders/old", chapter: "Orders", ask: "Old branch", skipped: false, applies: false, value: "x", recordings: [] },
          ],
        },
      ],
    }
    const rs = answerRecords(exp, [scan(feature, "orders.feature")], ledger)
    expect(rs.map((r) => r.id)).toEqual(["orders/cutoff", "orders/sources"])
    expect(rs[0].said).toBe("2pm\n\nthe day before\n\ntwo, the day before")
    expect(rs[0].scenarios).toEqual(["Orders: a late order"])
    expect(rs[0].facts).toEqual(["cutoff"])
    expect(rs[1].scenarios).toEqual(["Orders: (feature)"])
    expect(rs[1].facts).toEqual(["flour-risk"])
  })
})
