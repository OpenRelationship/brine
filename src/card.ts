// The share card: a 1200×630 image for the link you send respondents (og:image), so the preview in
// Slack, email or a chat says who the interview is for, what it is, and how long it takes before
// anyone clicks. `card` returns SVG with no dependencies; `png` rasterises it, because link
// previews do not render SVG. Nothing here imports the rest of brine, so a host app can use it
// from plain Node.

export interface CardTheme {
  paper: string
  ink: string
  soft: string
  faint: string
  line: string
  accent: string
  dot: string
  sans: string
  mono: string
}

export interface CardOptions {
  /** Who the interview maps: "ContentJet". */
  company: string
  /** The big line, in the respondent's terms: "Help us make your work easier." */
  heading: string
  /** One or two sentences under it. */
  body?: string
  /** From estimate.ts `duration`: "about 20–45 minutes". */
  time: string
  /** "20–60, depending on your role". */
  questions?: string
  /** A third fact: "stop and pick up where you left off". */
  note?: string
  /** A square logo as a data: URI (read the file and base64 it; renderers do not fetch). */
  mark?: string
  theme?: Partial<CardTheme>
}

export const CARD = { width: 1200, height: 630 }

const DEFAULT: CardTheme = {
  paper: "#f8f7f4",
  ink: "#25232e",
  soft: "#5e5b6b",
  faint: "#8a8797",
  line: "#dcdae0",
  accent: "#5b4fe0",
  dot: "rgba(37,35,46,0.09)",
  sans: "Inter, Helvetica Neue, Helvetica, Arial, sans-serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// SVG text does not wrap. Break on words at an estimated width (average glyph ≈ 0.52em for a
// sans), and end the last allowed line with an ellipsis rather than overflow.
function wrap(text: string, size: number, width: number, lines: number): string[] {
  const max = Math.floor(width / (size * 0.52))
  const out: string[] = []
  let cur = ""
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur || (cur + " " + w).length <= max) cur = cur ? `${cur} ${w}` : w
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  if (out.length > lines) {
    out.length = lines
    out[lines - 1] = out[lines - 1].replace(/[\s,.;:]*\S*$/, "") + "…"
  }
  return out
}

export function card(o: CardOptions): string {
  const t = { ...DEFAULT, ...o.theme }
  const { width: W, height: H } = CARD
  const X = 80
  const inner = W - X * 2
  const heading = wrap(o.heading, 64, inner, 2)
  const body = o.body ? wrap(o.body, 28, inner - 80, 2) : []
  const headY = 250
  const bodyY = headY + heading.length * 74 + 8
  const facts = [
    ["Time", o.time],
    ...(o.questions ? [["Questions", o.questions]] : []),
    ...(o.note ? [["Pace", o.note]] : []),
  ]
  const col = inner / facts.length
  const label = (x: number, y: number, s: string, fill = t.faint) =>
    `<text x="${x}" y="${y}" font-family="${esc(t.mono)}" font-size="16" letter-spacing="2.4" fill="${fill}">${esc(s.toUpperCase())}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.5" fill="${t.dot}"/></pattern>
    <clipPath id="mark"><circle cx="${X + 28}" cy="104" r="28"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="${t.paper}"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${t.accent}"/>
  ${o.mark ? `<image href="${esc(o.mark)}" x="${X}" y="76" width="56" height="56" clip-path="url(#mark)"/>` : ""}
  <text x="${o.mark ? X + 76 : X}" y="114" font-family="${esc(t.sans)}" font-size="30" font-weight="600" fill="${t.ink}">${esc(o.company)}</text>
  ${label(W - X, 110, "mapped with brine").replace("<text ", '<text text-anchor="end" ')}
  ${heading.map((l, i) => `<text x="${X}" y="${headY + i * 74}" font-family="${esc(t.sans)}" font-size="64" font-weight="600" letter-spacing="-1.4" fill="${t.ink}">${esc(l)}</text>`).join("\n  ")}
  ${body.map((l, i) => `<text x="${X}" y="${bodyY + 30 + i * 40}" font-family="${esc(t.sans)}" font-size="28" fill="${t.soft}">${esc(l)}</text>`).join("\n  ")}
  <line x1="${X}" y1="486" x2="${W - X}" y2="486" stroke="${t.line}" stroke-width="2"/>
  ${facts
    .map(([k, v], i) => {
      const x = X + i * col
      return `${label(x, 528, k)}
  <text x="${x}" y="570" font-family="${esc(t.sans)}" font-size="30" font-weight="500" fill="${i === 0 ? t.accent : t.ink}">${esc(wrap(v, 30, col - 24, 1)[0])}</text>`
    })
    .join("\n  ")}
</svg>
`
}

/** Minimal shape of @resvg/resvg-js's Resvg, so a host can pass its own copy. */
type ResvgClass = new (svg: string, opts: object) => { render(): { asPng(): Uint8Array } }

/**
 * The card as PNG. Needs @resvg/resvg-js (an optional dependency); pass `Resvg` to use the host's
 * copy. `fonts` are .ttf/.otf files for the theme's families; system fonts fill the rest.
 */
export async function png(svg: string, opts: { fonts?: string[]; Resvg?: ResvgClass } = {}): Promise<Uint8Array> {
  const Resvg = opts.Resvg ?? ((await import("@resvg/resvg-js")) as { Resvg: ResvgClass }).Resvg
  const r = new Resvg(svg, { fitTo: { mode: "width", value: CARD.width }, font: { fontFiles: opts.fonts ?? [], loadSystemFonts: true } })
  return r.render().asPng()
}
