export const MAIN_TTL_MS = 60 * 60_000
export const SUB_TTL_MS = 5 * 60_000

const STRIP_CELLS = 48
const STRIP_CELL_MS = 5 * 60_000

export type Stage = 'LIVE' | 'HOT' | 'WARM' | 'COOLING' | 'COLD'
export type ColorMode = 'hex' | 'named'
export const COLOR_MODE: ColorMode = 'hex'

export type Cell = { char: string; color: string; isEmpty: boolean }
export type StripCell = { char: string; color: string }

const STOPS: [number, number[]][] = [
  [0, [0x37, 0x8a, 0xdd]],
  [0.33, [0x1d, 0x9e, 0x75]],
  [0.66, [0xef, 0x9f, 0x27]],
  [1, [0xe2, 0x4b, 0x4a]],
]
const EIGHTHS = '▏▎▍▌▋▊▉'

function clamp(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

export function fraction(lastAt: number | null, now: number, isWorking: boolean): number | null {
  if (isWorking) return 1
  if (lastAt === null) return null
  return clamp(1 - (now - lastAt) / MAIN_TTL_MS)
}

export function stageOf(f: number, isWorking: boolean): Stage {
  if (isWorking) return 'LIVE'
  if (f >= 0.66) return 'HOT'
  if (f >= 0.33) return 'WARM'
  if (f > 0) return 'COOLING'
  return 'COLD'
}

export function minutesLeft(lastAt: number, now: number): number {
  return Math.min(60, Math.max(0, Math.ceil((lastAt + MAIN_TTL_MS - now) / 60_000)))
}

export function minutesCold(lastAt: number, now: number): number {
  return Math.max(0, Math.floor((now - lastAt - MAIN_TTL_MS) / 60_000))
}

function hex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function heat(x: number, mode: ColorMode = COLOR_MODE): string {
  const v = clamp(x)
  if (mode === 'named') return v < 0.25 ? 'blue' : v < 0.5 ? 'cyan' : v < 0.75 ? 'yellow' : 'red'
  for (let i = 1; i < STOPS.length; i++) {
    const [from, low] = STOPS[i - 1]
    const [to, high] = STOPS[i]
    if (v <= to) {
      const t = (v - from) / (to - from)
      return '#' + low.map((c, k) => hex(Math.round(c + (high[k] - c) * t))).join('')
    }
  }
  return '#e24b4a'
}

// Text colours. The mod cannot read the theme of Claude Code, so one palette has to read on a white and on a dark background.
// The relative luminance (WCAG) of a text colour stays between 0.14 and 0.30: the contrast is at least 3:1 against #ffffff and against #1e1e1e.
// A colour out of the range is scaled to this much inside it, so that the rounding to 8 bits cannot leave the range
const TEXT_MIN_LUMINANCE = 0.14
const TEXT_MAX_LUMINANCE = 0.3
const TEXT_MARGIN = 0.005

const toLinear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const toChannel = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)))

// The relative luminance of linear RGB values
const luminanceOf = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// The colour of heat(x) for text: the same hue, scaled in linear RGB into the luminance range. Use it for each word and number in a heat colour.
// Use heat(x) for graphics: the cells of a tube, a bar, the strip and the week history, and the SVG documents.
// The named colours follow the theme of the terminal, so they stay as they are
export function heatText(x: number, mode: ColorMode = COLOR_MODE): string {
  const color = heat(x, mode)
  if (mode === 'named') return color
  const linear = [1, 3, 5].map((i) => toLinear(parseInt(color.slice(i, i + 2), 16)))
  const luminance = luminanceOf(linear)
  if (luminance >= TEXT_MIN_LUMINANCE && luminance <= TEXT_MAX_LUMINANCE) return color
  const target = luminance > TEXT_MAX_LUMINANCE ? TEXT_MAX_LUMINANCE - TEXT_MARGIN : TEXT_MIN_LUMINANCE + TEXT_MARGIN
  return '#' + linear.map((l) => hex(toChannel((l * target) / luminance))).join('')
}

// The tube runs from cold at the left to hot at the right and empties from the hot end
export function tubeCells(f: number, n: number, mode: ColorMode = COLOR_MODE): Cell[] {
  const x = cellsOf(clamp(f), n)
  const full = Math.floor(x)
  const eighths = Math.floor((x - full) * 8)
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) {
    const color = heat((i + 0.5) / n, mode)
    if (i < full) cells.push({ char: '█', color, isEmpty: false })
    else if (i === full && eighths >= 1) cells.push({ char: EIGHTHS[eighths - 1], color, isEmpty: false })
    else cells.push({ char: '░', color, isEmpty: true })
  }
  return cells
}

// The filled length of a bar in cells. Rounding to 6 decimals keeps float noise from showing a full cell as a partial one
function cellsOf(v: number, n: number): number {
  return Math.round(v * n * 1e6) / 1e6
}

const num = (x: number) => String(Number(x.toFixed(2)))

function svgDoc(width: number, height: number, parts: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + parts + '</svg>'
}

function backRect(x: number, color: string): string {
  return '<rect x="' + x + '" y="1" width="8" height="12" rx="2" fill="' + color + '" opacity="0.18"/>'
}

// The outline of a cell that has not come yet: the cell rect inset by half a pixel, so that its 1 px stroke stays inside the cell.
// The grey and its opacity show on a dark and on a light background, so the Svg needs no theme colour
function outlineRect(x: number): string {
  return '<rect x="' + (x + 0.5) + '" y="1.5" width="7" height="11" rx="1.5" fill="none" stroke="#8a8a8a" stroke-opacity="0.7" stroke-width="1"/>'
}

// A row of cells, 9 wide each: a background and a fill that grows from the left. A cell with no colour draws nothing
function cellRects(x0: number, cells: { color: string; fill: number }[]): string {
  return cells
    .map(({ color, fill }, i) => {
      if (color === '') return ''
      const x = x0 + i * 9
      return backRect(x, color) + (fill > 0 ? '<rect x="' + x + '" y="1" width="' + num(8 * fill) + '" height="12" rx="2" fill="' + color + '"/>' : '')
    })
    .join('')
}

// The cells of the tube: x is the filled length in cells
function tubeParts(x: number, n: number): { color: string; fill: number }[] {
  return Array.from({ length: n }, (_, i) => ({ color: heat((i + 0.5) / n, 'hex'), fill: clamp(x - i) }))
}

// The tube and every bar of a share or a percent as an SVG document for the desktop surface: n rounded cells that fill continuously
export function barSvg(f: number, n: number): string {
  return svgDoc(n * 9, 14, cellRects(0, tubeParts(cellsOf(clamp(f), n), n)))
}

// The cache strip: a full cell when warm, a background when cold, nothing without a request
export function stripSvg(cells: StripCell[]): string {
  const parts = cellRects(0, cells.map((c) => ({ color: c.color, fill: c.char === '█' ? 1 : 0 })))
  return svgDoc(cells.length * 9, 14, parts)
}

// One column for each cell, as high as its percent, at least one eighth. A past cell without a percent draws only a cold background, a future cell draws an outline
export function sparkSvg(cells: { percent: number | null; isFuture?: boolean }[]): string {
  const parts = cells.map(({ percent, isFuture }, i) => {
    const x = i * 9
    if (percent === null) return isFuture ? outlineRect(x) : backRect(x, heat(0, 'hex'))
    const color = heat(percent / 100, 'hex')
    const h = 12 * Math.max(1 / 8, clamp(percent / 100))
    return backRect(x, color) + '<rect x="' + x + '" y="' + num(13 - h) + '" width="8" height="' + num(h) + '" rx="' + num(Math.min(2, h / 2)) + '" fill="' + color + '"/>'
  })
  return svgDoc(cells.length * 9, 14, parts.join(''))
}

export function tubeAlt(f: number): string {
  const v = clamp(f)
  return v <= 0 ? 'cache cold' : 'cache ' + Math.max(1, Math.round(v * 100)) + '% left'
}

// One cell for each 5 minutes of the last 4 hours, coloured by the temperature at the end of the cell
export function stripCells(requestTimes: number[], now: number, mode: ColorMode = COLOR_MODE): StripCell[] {
  const cells: StripCell[] = []
  for (let i = 0; i < STRIP_CELLS; i++) {
    const end = now - (STRIP_CELLS - 1 - i) * STRIP_CELL_MS
    const before = requestTimes.filter((t) => t <= end)
    if (before.length === 0) {
      cells.push({ char: ' ', color: '' })
      continue
    }
    const f = clamp(1 - (end - Math.max(...before)) / MAIN_TTL_MS)
    cells.push(f > 0 ? { char: '█', color: heat(f, mode) } : { char: '░', color: heat(0, mode) })
  }
  return cells
}

// The strip cell that holds a time, or null when the time is outside the strip. Cell i covers (start + i * 5 min, start + (i + 1) * 5 min], as in stripCells
export function stripCellAt(at: number, now: number): number | null {
  const i = Math.ceil((at - (now - STRIP_CELLS * STRIP_CELL_MS)) / STRIP_CELL_MS) - 1
  return i >= 0 && i < STRIP_CELLS ? i : null
}
