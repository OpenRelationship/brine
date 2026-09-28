import { describe, expect, test } from "bun:test"
import { interview } from "../example/src/interview"
import { card } from "../src/card"
import { check } from "../src/check"
import { duration, minutes, seconds } from "../src/estimate"

describe("estimate", () => {
  test("times a walk by the kinds it asks", () => {
    expect(seconds(["long", "choice", "text"])).toBe(50)
    expect(minutes(50)).toBe(5)
    expect(minutes(31 * 60)).toBe(35)
  })

  test("100 questions, half of them long answers, take about 30 minutes (real sittings)", () => {
    const kinds = [...Array(50).fill("long"), ...Array(40).fill("choice"), ...Array(6).fill("text"), "number", "number", "multi", "multi"]
    expect(Math.abs(seconds(kinds) / 60 - 30)).toBeLessThan(1)
  })

  test("reads as minutes, then hours", () => {
    expect(duration(20, 45)).toBe("about 20–45 minutes")
    expect(duration(15)).toBe("about 15 minutes")
    expect(duration(30, 120)).toBe("about 30 minutes to 2 hours")
    expect(duration(90, 150)).toBe("about 1½–2½ hours")
  })

  test("check times the sampled walks", () => {
    const { minutes: m, walks } = check(interview).stats
    expect(walks.max).toBeGreaterThan(0)
    expect(m.min).toBeGreaterThanOrEqual(5)
    expect(m.max).toBeGreaterThanOrEqual(m.min)
  })
})

describe("card", () => {
  const svg = card({ company: "Sam & Co", heading: "How the <bakery> runs", time: "about 5–10 minutes", questions: "5–8" })

  test("is a 1200×630 SVG with the company, the heading and the time", () => {
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"')
    expect(svg).toContain("Sam &amp; Co")
    expect(svg).toContain("How the &lt;bakery&gt; runs")
    expect(svg).toContain("about 5–10 minutes")
  })

  test("a long heading wraps to two lines and ends in an ellipsis", () => {
    const long = card({ company: "X", heading: "word ".repeat(80), time: "t" })
    const lines = [...long.matchAll(/font-size="64"[^>]*>([^<]*)</g)].map((m) => m[1])
    expect(lines).toHaveLength(2)
    expect(lines[1]).toEndWith("…")
  })
})
