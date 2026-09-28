import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { check } from "../src/check"
import { followup, scan, trace } from "../src/loop"

const feature = `# Source: an interview
@orders @q:orders/sources
Feature: Taking orders
  In order to bake the right amount

  Rule: orders close at 2pm the day before

    @q:orders/cutoff
    Scenario: a late order
      When an order arrives at 3pm
      Then it goes to the day after
      # TODO: what counts as late for a wholesale order?
      # CONFLICT: the site says noon
      # RULED: 2pm, the site is stale (owner, 2026-09-27)

  Rule: wholesale is paid on account

    @q:orders/wholesale @q:orders/nope
    Scenario: a wholesale order
      Then it is invoiced monthly
      # IDEA: card payments

  Scenario: an untagged one
    Then nothing

  # TODO: anything else about orders?
`

describe("scan", () => {
  const s = scan(feature, "orders.feature")
  test("reads the feature, rules and scenarios with their sources", () => {
    expect(s.feature).toBe("Taking orders")
    expect(s.rules).toEqual(["orders close at 2pm the day before", "wholesale is paid on account"])
    expect(s.scenarios.map((x) => x.sources)).toEqual([["orders/cutoff"], ["orders/wholesale", "orders/nope"], []])
    expect(s.scenarios[0].rule).toBe("orders close at 2pm the day before")
  })
  test("a marker at the feature's indent belongs to the feature", () => {
    expect(s.notes).toEqual([{ marker: "TODO", text: "anything else about orders?", line: 26 }])
    expect(s.scenarios[2].notes).toEqual([])
  })
  test("keeps markers under the scenario they follow", () => {
    expect(s.scenarios[0].notes.map((n) => n.marker)).toEqual(["TODO", "CONFLICT", "RULED"])
    expect(s.scenarios[1].notes[0]).toMatchObject({ marker: "IDEA", text: "card payments" })
  })
})

describe("trace", () => {
  const t = trace(interview, [scan(feature, "orders.feature")], ["orders/cutoff", "orders/sources", "orders/wholesale_exception"])
  test("an unknown tag is reported with its place", () => {
    expect(t.unknown).toEqual([{ path: "orders.feature", line: 19, id: "orders/nope" }])
  })
  test("answers no scenario cites are listed", () => {
    expect(t.uncited).toEqual(["orders/wholesale_exception"])
    expect(t.cited["orders/sources"]).toEqual(["orders.feature: Feature"])
    expect(t.cited["orders/cutoff"]).toEqual(["orders.feature: a late order"])
  })
  test("untagged scenarios are listed", () => {
    expect(t.untagged.map((u) => u.name)).toEqual(["an untagged one"])
  })
})

describe("followup", () => {
  const f = followup([scan(feature, "orders.feature")], { id: "round-2", title: "Round two" })
  const [c] = f.interview.chapters
  test("each feature reads its rules back as one question", () => {
    expect(c.questions[0]).toMatchObject({ id: "readback", kind: "choice", note: true, context: ["orders close at 2pm the day before", "wholesale is paid on account"] })
  })
  test("each TODO becomes a question that cites where it came from", () => {
    expect(c.questions[1]).toMatchObject({ id: "gap-1", kind: "long", ask: "what counts as late for a wholesale order?" })
    expect(c.questions[1].why).toContain("orders/cutoff")
  })
  test("a conflict with a ruling under it is settled", () => {
    const g = followup([scan(feature.replace("      # RULED: 2pm, the site is stale (owner, 2026-09-27)\n", ""), "orders.feature")], { id: "r", title: "r" })
    expect(g.conflicts).toHaveLength(1)
    expect(f.conflicts).toEqual([])
  })
  test("conflicts are never asked", () => {
    expect(c.questions).toHaveLength(3)
  })
  test("the draft passes the design check", () => {
    expect(check(f.interview, 20).errors).toEqual([])
  })
})
