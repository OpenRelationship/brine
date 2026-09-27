import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { check } from "../src/check"
import type { Interview } from "../src/spec"
import { answer, back, begin, compile, END, fallbacks, jump, progress } from "../src/walk"

const walk = compile(interview)

describe("walk", () => {
  test("starts at the first question", () => {
    expect(begin(walk).at).toBe("orders/sources")
  })

  test("a guard skips what does not apply", () => {
    const s = answer(walk, begin(walk), "orders/sources", { value: ["walkin"] })
    expect(s.at).toBe("orders/cutoff")
  })

  test("a guard opens what does", () => {
    const s = answer(walk, begin(walk), "orders/sources", { value: ["walkin", "wholesale"] })
    expect(s.at).toBe("orders/wholesale")
  })

  test("a decision opens the follow-up only when it says so", () => {
    let s = answer(walk, begin(walk), "orders/sources", { value: ["wholesale"] })
    const yes = answer(walk, s, "orders/wholesale", { value: "..." }, { exception: "yes" })
    expect(yes.at).toBe("orders/wholesale_exception")
    const no = answer(walk, s, "orders/wholesale", { value: "..." }, { exception: "no" })
    expect(no.at).toBe("orders/cutoff")
  })

  test("a choice can jump to another chapter", () => {
    let s = answer(walk, begin(walk), "orders/sources", { value: ["walkin"] })
    s = answer(walk, s, "orders/cutoff", { value: "no" })
    expect(s.at).toBe("bake/plan")
  })

  test("a skipped answer satisfies no guard", () => {
    const s = answer(walk, begin(walk), "orders/sources", { skipped: true })
    expect(s.at).toBe("orders/cutoff")
  })

  test("back retraces and keeps the answer", () => {
    const s = back(answer(walk, begin(walk), "orders/sources", { value: ["phone"] }))
    expect(s.at).toBe("orders/sources")
    expect(s.answers["orders/sources"].value).toEqual(["phone"])
  })

  test("re-answering replaces that question's decisions", () => {
    let s = answer(walk, begin(walk), "orders/sources", { value: ["wholesale"] })
    s = answer(walk, s, "orders/wholesale", { value: "a" }, { exception: "yes" })
    s = back(back(s))
    s = answer(walk, s, "orders/sources", { value: ["wholesale"] })
    s = answer(walk, s, "orders/wholesale", { value: "b" }, { exception: "no" })
    expect(s.decisions["orders/wholesale.exception"]).toBe("no")
    expect(s.at).toBe("orders/cutoff")
  })

  test("the last answer ends the walk", () => {
    let s = jump(walk, begin(walk), "bake")
    for (const id of ["bake/plan", "bake/waste", "bake/busy"]) s = answer(walk, s, id, { value: id === "bake/busy" ? "1" : "x" })
    expect(s.at).toBe(END)
    expect(s.finished).toBeString()
  })

  test("progress counts only what applies", () => {
    const s = answer(walk, begin(walk), "orders/sources", { value: ["walkin"] })
    const orders = progress(walk, s).find((c) => c.id === "orders")!
    expect(orders.total).toBe(3) // sources, cutoff, cutoff_time
    expect(orders.answered).toBe(1)
  })

  test("fallbacks are the designer's", () => {
    expect(fallbacks(interview.chapters[0].questions[1])).toEqual({ exception: "yes" })
  })
})

describe("check", () => {
  test("the example passes", () => {
    const r = check(interview)
    expect(r.errors).toEqual([])
    expect(r.stats.questions).toBe(8)
    expect(r.stats.walks.max).toBeLessThanOrEqual(8)
  })

  test("it catches the usual mistakes", () => {
    const bad: Interview = {
      ...interview,
      chapters: [
        {
          id: "a",
          title: "A",
          questions: [
            { id: "x", kind: "choice", ask: "?", why: "", yields: "y", options: [{ value: "1", label: "1", next: "x" }, { value: "1", label: "2" }] },
            { id: "y", kind: "long", ask: "?", why: "w", yields: "y", when: { q: "z", answered: true }, decide: { d: { type: "noul", instructions: "?", fallback: "maybe" } } },
            { id: "z", kind: "long", ask: "?", why: "w", yields: "y", when: { q: "y", decision: "nope", is: "yes" } },
            { id: "w", kind: "long", ask: "?", why: "w", yields: "y", when: { q: "x", is: "3" } },
          ],
        },
      ],
    }
    const e = check(bad).errors.join("\n")
    expect(e).toContain("a/x: no why")
    expect(e).toContain("duplicate option values")
    expect(e).toContain("goes backwards")
    expect(e).toContain("not asked before it")
    expect(e).toContain("fallback maybe")
    expect(e).toContain("has none")
    expect(e).toContain("has no option 3")
  })
})
