import type { Counts, Limit, Reading } from '../types'
import { minutesCold, minutesLeft, type Stage } from './temperature'

export type Align = 'left' | 'right'
export type Column = { width: number; align: Align }
export type HistoryCell = { char: string; percent: number | null; isFuture: boolean }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SPARK = '▁▂▃▄▅▆▇█'
const HISTORY_MS = 12 * 3_600_000
const HISTORY_CELLS = 14
const LIMIT_LABELS: Record<string, string> = { seven_day: 'week', five_hour: '5h', spend_limit: 'spend' }
const LIMIT_ORDER = ['seven_day', 'five_hour', 'spend_limit']
// The window of a limit ends at its reset. The spend limit has no window, so it has no projection
const LIMIT_WINDOWS: Record<string, number> = { seven_day: 7 * 24 * 3_600_000, five_hour: 5 * 3_600_000 }

export function formatTokens(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  for (const [divisor, unit] of [
    [1e3, 'k'],
    [1e6, 'M'],
    [1e9, 'B'],
  ] as const) {
    const value = n / divisor
    if (value < 99.95) return value.toFixed(1) + unit
    if (value < 999.5) return Math.round(value) + unit
  }
  return Math.round(n / 1e9) + 'B'
}

export function formatMoney(x: number): string {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return '$0.00'
  const [whole, cents] = x.toFixed(2).split('.')
  return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + cents
}

export function formatPercent(p: number): string {
  return String(Math.round(p * 10) / 10) + '%'
}

export function shortModel(id: string): string {
  if (typeof id !== 'string' || id === '') return 'unknown'
  return id.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function repoName(root: string): string {
  const trimmed = (root ?? '').replace(/\/\.(claude\/)?worktrees\/[^/]+\/?$/, '').replace(/\/+$/, '')
  const name = trimmed.split('/').pop() ?? ''
  return name === '' ? 'unknown' : name
}

// The desktop app counts the room of a tree in cells of its code font, but it draws Text in its proportional font, Anthropic Sans.
// These are the widths of the printable ASCII characters in that font, in hundredths of a code-font cell, from code 32 (space) to 126 (~):
// the advance of Text Regular (of Bold for a capital, which the stage words use) times 1.62 cells per em, rounded up.
// The 1.62 comes from a screenshot of the desktop app: a column of 63 cells in the Week tab, and the band text drawn beside it
const DESKTOP_ASCII = [
  // space ! " # $ % & ' ( ) * + , - . /
  35, 39, 67, 104, 85, 161, 111, 39, 66, 66, 80, 104, 39, 59, 39, 55,
  // 0 1 2 3 4 5 6 7 8 9 : ; < = > ?
  98, 61, 95, 91, 100, 92, 93, 87, 91, 93, 39, 39, 104, 104, 104, 89,
  // @ A to O
  142, 125, 109, 126, 124, 106, 99, 131, 123, 48, 94, 120, 96, 153, 129, 133,
  // P to Z [ \ ] ^ _
  104, 133, 114, 103, 96, 119, 125, 172, 120, 117, 110, 66, 55, 66, 104, 82,
  // ` a to o
  82, 89, 101, 90, 101, 94, 68, 93, 97, 41, 42, 92, 41, 142, 97, 95,
  // p to z { | } ~
  101, 101, 66, 84, 68, 96, 92, 134, 93, 93, 82, 66, 50, 66, 104,
]
const DESKTOP_OTHER: Record<string, number> = { '·': 39, '→': 133, '≈': 104, '…': 163 }
// A character outside both tables counts as 2.2 cells: wider than W (1.72) and than a full-width glyph (1 em, 1.62), and as wide as an emoji of 1.35 em
const DESKTOP_WIDEST = 220

// The width of a text on the desktop, in cells of its code font
export function desktopCells(text: string): number {
  let sum = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    sum += (code >= 32 && code <= 126 ? DESKTOP_ASCII[code - 32] : DESKTOP_OTHER[ch]) ?? DESKTOP_WIDEST
  }
  return sum / 100
}

// Pads a text to the column width; a cut text ends in an ellipsis, and one space always stays free
export function cell(text: string, column: Column): string {
  let chars = Array.from(text)
  const room = column.width - 1
  if (chars.length > room) chars = [...chars.slice(0, Math.max(0, room - 1)), '…']
  const gap = ' '.repeat(column.width - chars.length)
  return column.align === 'right' ? gap + chars.join('') : chars.join('') + gap
}

// The mark after the name of a model whose cost comes from a fallback price
export const ESTIMATE_MARK = ' ≈'

// A name with the estimate mark after it. A name that is too long for the column is cut with an ellipsis, and the mark stays whole.
// The result fits the column with the one free cell that cell() keeps, so cell() does not cut it again
export function markedCell(name: string, column: Column): string {
  const room = column.width - 1
  const chars = Array.from(name)
  const mark = Array.from(ESTIMATE_MARK).length
  if (chars.length + mark <= room) return name + ESTIMATE_MARK
  return chars.slice(0, Math.max(0, room - mark - 1)).join('') + '…' + ESTIMATE_MARK
}

// The indexes of the columns that stay: while the table is wider than the room, columns go in the drop order
export function fitColumns(widths: number[], dropOrder: number[], available: number | undefined): number[] {
  const kept = widths.map((_, i) => i)
  if (typeof available !== 'number' || !Number.isFinite(available)) return kept
  let total = widths.reduce((s, w) => s + w, 0)
  for (const i of dropOrder) {
    if (total <= available) break
    const at = kept.indexOf(i)
    if (at === -1) continue
    kept.splice(at, 1)
    total -= widths[i]
  }
  return kept
}

// The items joined by commas. A list that is too long keeps its last items after an ellipsis
export function fitList(items: string[], room: number): string {
  const all = items.join(', ')
  const length = (text: string) => Array.from(text).length
  if (length(all) <= room) return all
  let kept = ''
  for (let i = items.length - 1; i >= 0; i--) {
    const next = kept === '' ? items[i] : items[i] + ', ' + kept
    if (length('… ' + next) > room) break
    kept = next
  }
  return kept === '' ? '…' : '… ' + kept
}

export type ResumeMark = { cell: number; cost: string }
export type PlacedMark = { cell: number; cost: string | null }
export type PlacedMarks = { marks: PlacedMark[]; list: { at: number; text: string } | null }

// The free cells between a list of costs and the nearest item of its row
const LIST_GAP = 2

// Places the resume marks in a row of `width` cells; the last cell stays free, as in cell().
// A label is the mark, a space and the cost. It stays whole and needs one free cell before the next mark, or before the end of the row.
// A mark with no room for its label shows only the mark, and its cost goes to a list of costs in time order.
// The list starts after the last item of the row. When it does not fit there, it ends before the first mark without a label, after the item before that mark.
// When it fits in neither place, it takes the larger place, and fitList keeps the newest costs behind an ellipsis.
export function placeMarks(marks: ResumeMark[], width: number): PlacedMarks {
  const length = (text: string) => Array.from(text).length
  const itemEnd = (mark: PlacedMark) => mark.cell + (mark.cost === null ? 1 : 2 + length(mark.cost))
  const sorted = [...marks].sort((a, b) => a.cell - b.cell)
  const placed: PlacedMark[] = []
  const unlabelled: ResumeMark[] = []
  sorted.forEach((mark, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1].cell : width
    // Two resumes in one cell share its mark: the later one has the label
    const isFit = next !== mark.cell && mark.cell + 2 + length(mark.cost) < next
    if (next !== mark.cell) placed.push({ cell: mark.cell, cost: isFit ? mark.cost : null })
    if (!isFit) unlabelled.push(mark)
  })
  if (unlabelled.length === 0) return { marks: placed, list: null }
  const costs = unlabelled.map((m) => m.cost)
  const all = costs.join(', ')
  const after = itemEnd(placed[placed.length - 1]) + LIST_GAP
  const roomAfter = width - 1 - after
  if (length(all) <= roomAfter) return { marks: placed, list: { at: after, text: all } }
  const anchor = unlabelled[0].cell
  const earlier = placed.filter((m) => m.cell < anchor).pop()
  const roomBefore = anchor - LIST_GAP - (earlier === undefined ? 0 : itemEnd(earlier) + LIST_GAP)
  const isBefore = length(all) <= roomBefore || roomBefore > roomAfter
  const room = isBefore ? roomBefore : roomAfter
  if (room < 1) return { marks: placed, list: null }
  const text = fitList(costs, room)
  return { marks: placed, list: { at: isBefore ? anchor - LIST_GAP - length(text) : after, text } }
}

export function line(cells: string[], columns: Column[]): string {
  return columns.map((column, i) => cell(cells[i] ?? '', column)).join('')
}

export function ageText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h'
}

function rank(kind: string): number {
  const i = LIMIT_ORDER.indexOf(kind)
  return i === -1 ? LIMIT_ORDER.length : i
}

// The age of the last limit reading, when it is older than 30 minutes: `(2h ago)`. Empty when the reading is recent or unknown
export function limitsAgeText(limitsAt: number | null, now: number): string {
  return limitsAt !== null && now - limitsAt > 30 * 60_000 ? '(' + ageText(now - limitsAt) + ' ago)' : ''
}

// A limit in the band: its kind, its text (`week 49%`) and its projection (` → 100% Sat 21:06`, or empty)
export type LimitItem = { kind: string; text: string; projection: string }

// The limits in the order week, 5h, spend. readAt is the time of the reading, or null for no projections
export function limitItems(limits: Limit[], readAt: number | null, now: number): LimitItem[] {
  return [...limits]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((limit) => ({ kind: limit.kind, text: (LIMIT_LABELS[limit.kind] ?? limit.kind) + ' ' + formatPercent(limit.percentUsed), projection: limitProjection(limit, readAt, now) }))
}

// The time when a limit reaches 100%, at the pace from the start of its window up to the reading. Null without a pace.
// The pace ends at the reading and not at now: an old reading would give a time that is too late
export function fullAt(percent: number, start: number, readAt: number): number | null {
  if (!Number.isFinite(percent) || percent <= 0 || readAt <= start) return null
  return start + ((readAt - start) * 100) / percent
}

// The projection of a limit in the band: ` → 100% Sat 21:06`. It is empty for a limit without a window or a reset time,
// when the limit reaches 100% at or after its reset, and when the time has passed: an old reading, or a limit at 100%
export function limitProjection(limit: Limit, readAt: number | null, now: number): string {
  const window = LIMIT_WINDOWS[limit.kind]
  const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
  if (window === undefined || readAt === null || !Number.isFinite(resetAt)) return ''
  const at = fullAt(limit.percentUsed, resetAt - window, readAt)
  return at !== null && at < resetAt && at > now ? ' → 100% ' + dayTime(at) : ''
}

// rewarm is the cost to write the context again, or null for a model without a price. isEstimated marks a cost from a fallback price with `≈`
export function tubeLabel(stage: Stage, lastAt: number | null, now: number, contextTokens: number, rewarm: number | null, isEstimated: boolean = false): string {
  const cached = formatTokens(contextTokens)
  if (stage === 'LIVE' || lastAt === null) return contextTokens > 0 ? 'in turn · ' + cached + ' cached' : 'in turn'
  if (stage === 'COLD') return minutesCold(lastAt, now) + 'm · next message re-writes ' + cached + (rewarm === null ? '' : ' ≈ ' + formatMoney(rewarm))
  return minutesLeft(lastAt, now) + 'm left · ' + cached + ' cached' + (rewarm === null ? '' : ' · ' + (isEstimated ? '≈ ' : '') + formatMoney(rewarm) + ' to re-warm')
}

export function modelsText(rows: { model: string; counts: Counts }[]): string {
  return rows
    .map(
      (row) =>
        shortModel(row.model) +
        ' r' +
        formatTokens(row.counts.cacheRead) +
        ' w' +
        formatTokens(row.counts.cacheWrite) +
        ' o' +
        formatTokens(row.counts.output),
    )
    .join(' | ')
}

export function dayTime(ms: number): string {
  const d = new Date(ms)
  return DAYS[d.getDay()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// The projection of the Week tab. readAt is the time of the weekly reading, or null without a reading.
// A time that has passed is left out, as in the band
export function projectionText(percent: number | null, start: number, readAt: number | null, resetAt: number | null, now: number): string {
  if (percent === null || readAt === null || resetAt === null) return ''
  const at = fullAt(percent, start, readAt)
  if (at === null || at >= resetAt) return 'below 100% at reset'
  return at > now ? '100% on ' + dayTime(at) : ''
}

// Always the 14 periods of the week: a period that starts at or after now is a future cell, a past period without a reading is an empty cell
export function historyCells(readings: Reading[], start: number, now: number): HistoryCell[] {
  const weekly = readings.filter((r) => r.kind === 'seven_day' && Number.isFinite(r.percentUsed))
  return Array.from({ length: HISTORY_CELLS }, (_, i): HistoryCell => {
    const from = start + i * HISTORY_MS
    if (from >= now) return { char: ' ', percent: null, isFuture: true }
    const inPeriod = weekly.filter((r) => r.at >= from && r.at < from + HISTORY_MS)
    if (inPeriod.length === 0) return { char: '░', percent: null, isFuture: false }
    const top = Math.max(...inPeriod.map((r) => r.percentUsed))
    return { char: SPARK[Math.min(7, Math.max(0, Math.floor((top / 100) * 8)))], percent: top, isFuture: false }
  })
}

// The first letter of each day of the week and a space, `S ` to `S `, so the names stand apart. Day i is the weekday of start + i * 24 h in local time, and it holds 2 cells of the history
export function weekDayNames(start: number): string[] {
  return Array.from({ length: HISTORY_CELLS / 2 }, (_, i) => DAYS[new Date(start + i * 24 * 3_600_000).getDay()].slice(0, 1) + ' ')
}
