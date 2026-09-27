import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { check } from "../src/check"
import type { Interview } from "../src/spec"
import { answer, back, begin, compile, END, fallbacks, goto, jump, progress, replay, resume, save, visible } from "../src/walk"

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
    const s = back(walk, answer(walk, begin(walk), "orders/sources", { value: ["phone"] }))
    expect(s.at).toBe("orders/sources")
    expect(s.answers["orders/sources"].value).toEqual(["phone"])
  })

  test("re-answering replaces that question's decisions", () => {
    let s = answer(walk, begin(walk), "orders/sources", { value: ["wholesale"] })
    s = answer(walk, s, "orders/wholesale", { value: "a" }, { exception: "yes" })
    s = back(walk, s)
    s = answer(walk, s, "orders/wholesale", { value: "b" }, { exception: "no" })
    expect(s.decisions["orders/wholesale.exception"]).toBe("no")
    expect(s.at).toBe("orders/cutoff")
  })

  test("the walk finishes only when every question on it is answered", () => {
    let s = jump(walk, begin(walk), "bake")
    for (const id of ["bake/plan", "bake/waste", "bake/busy"]) s = answer(walk, s, id, { value: id === "bake/busy" ? "1" : "x" })
    expect(s.at).toBe(END)
    expect(s.finished).toBeUndefined() // orders was never answered
    expect(replay(walk, s).frontier).toBe("orders/sources")
    s = resume(walk, s)
    s = answer(walk, s, "orders/sources", { value: ["walkin"] })
    s = answer(walk, s, "orders/cutoff", { value: "no" }) // jumps to bake, already answered
    expect(replay(walk, s).frontier).toBe(END)
    expect(s.finished).toBeString()
  })
})

describe("editing an earlier answer", () => {
  // Answer everything with walk-ins only, then go back and edit.
  function done() {
    let s = begin(walk)
    s = answer(walk, s, "orders/sources", { value: ["walkin"] })
    s = answer(walk, s, "orders/cutoff", { value: "yes" })
    s = answer(walk, s, "orders/cutoff_time", { value: "3pm" })
    for (const id of ["bake/plan", "bake/waste", "bake/busy"]) s = answer(walk, s, id, { value: id === "bake/busy" ? "1" : "x" })
    return s
  }

  test("the path and frontier are replayed from the answers", () => {
    const s = done()
    expect(replay(walk, s)).toEqual({ path: ["orders/sources", "orders/cutoff", "orders/cutoff_time", "bake/plan", "bake/waste", "bake/busy"], frontier: END })
    expect(s.finished).toBeString()
  })

  test("saving does not move, and a change that opens a follow-up makes it the frontier", () => {
    let s = goto(walk, done(), "orders/sources")
    s = save(walk, s, "orders/sources", { value: ["walkin", "wholesale"] })
    expect(s.at).toBe("orders/sources")
    expect(replay(walk, s).frontier).toBe("orders/wholesale")
    expect(s.finished).toBeUndefined()
    expect(resume(walk, s).at).toBe("orders/wholesale")
  })

  test("a change that closes a branch keeps its answers but they no longer apply", () => {
    let s = goto(walk, done(), "orders/cutoff")
    s = save(walk, s, "orders/cutoff", { value: "no" })
    expect(s.answers["orders/cutoff_time"].value).toBe("3pm")
    expect(visible(walk, "orders/cutoff_time", s)).toBeTrue() // guards pass; the jump just skips it
    expect(replay(walk, s).path).not.toContain("orders/cutoff_time")
    expect(replay(walk, s).frontier).toBe(END)
  })

  test("answering an earlier question steps along the walk, through answers already given", () => {
    let s = goto(walk, done(), "orders/cutoff")
    s = answer(walk, s, "orders/cutoff", { value: "yes" })
    expect(s.at).toBe("orders/cutoff_time")
    expect(s.answers["orders/cutoff_time"].value).toBe("3pm")
  })

  test("back from a question visited ahead lands on the walk", () => {
    let s = answer(walk, begin(walk), "orders/sources", { value: ["walkin"] })
    s = goto(walk, s, "bake/waste")
    expect(back(walk, s).at).toBe("orders/sources")
  })

  test("goto refuses a question that does not apply", () => {
    const s = answer(walk, begin(walk), "orders/sources", { value: ["walkin"] })
    expect(goto(walk, s, "orders/wholesale").at).toBe(s.at)
  })
})

describe("progress", () => {
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
