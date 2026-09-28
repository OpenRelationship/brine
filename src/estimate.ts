// How long a sitting takes. Rough on purpose: a respondent deciding whether to start wants "about
// 20 minutes", not a number to the second. Each kind of question gets a typical time (a long
// answer is a minute and a half of typing or talking, a choice is a tap), and a walk's time is the
// sum over the questions it actually asks.

export const SECONDS: Record<string, number> = { long: 90, text: 30, number: 15, multi: 15, choice: 10, scale: 10 }
const TYPICAL = 30

/** Seconds for a walk that asks questions of these kinds. */
export const seconds = (kinds: string[]) => kinds.reduce((n, k) => n + (SECONDS[k] ?? TYPICAL), 0)

/** Whole minutes, rounded up to the next five, never under five. */
export const minutes = (secs: number) => Math.max(5, Math.ceil(secs / 60 / 5) * 5)

/** "about 15 minutes", "about 20–45 minutes", "about 1–2½ hours". */
export function duration(lo: number, hi = lo): string {
  if (hi >= 90) {
    const h = (m: number) => {
      const halves = Math.max(1, Math.round(m / 30))
      return `${Math.floor(halves / 2) || ""}${halves % 2 ? "½" : ""}` || "½"
    }
    const a = h(lo), b = h(hi)
    return a === b ? `about ${b} ${b === "1" ? "hour" : "hours"}` : `about ${lo < 60 ? `${lo} minutes to ${b} hours` : `${a}–${b} hours`}`
  }
  return lo === hi ? `about ${hi} minutes` : `about ${lo}–${hi} minutes`
}
