import type { Breakdown, Cause, Causes, Counts, Limit, Main, Resume, Snapshot, Totals } from '../types'
import { cell, dayTime, fitColumns, formatMoney, formatPercent, formatTokens, historyCells, limitsAgeText, limitsText, markedCell, modelsText, placeMarks, projectionText, shortModel, tubeLabel, weekDayNames, type Column, type HistoryCell, type PlacedMarks, type ResumeMark } from './format'
import { priceInfo, rewarmCost } from './prices'
import { barSvg, fraction, heat, heatText, minutesLeft, sparkSvg, stageOf, stripCellAt, stripCells, stripSvg, tubeAlt, tubeCells, type Cell, type Stage, type StripCell } from './temperature'
import { STRIP_MS, groupWeek, mergeReadings, modelSums, weekOf, type NowRow, type Row, type Share } from './tally'

type El = (props: Record<string, any>) => unknown
// Svg exists only in the element table of the remote surfaces
export type Els = { Box: El; Text: El; Button: El; Svg?: El }
export type CellValue = string | unknown[]

const L = (width: number): Column => ({ width, align: 'left' })
const R = (width: number): Column => ({ width, align: 'right' })

// A money column is 10 cells wide: it holds $9,999.99 and the one free cell that cell() keeps
export const NOW_COLUMNS: Column[] = [L(22), L(21), L(11), R(6), R(10), R(10)]
export const SESSION_COLUMNS: Column[] = [L(11), L(16), R(5), R(7), R(9), R(7), R(8), R(10), R(7)]
export const CAUSE_COLUMNS: Column[] = [L(14), L(21), R(8), R(10), R(6)]
export const HISTORY_COLUMNS: Column[] = [L(16), L(49)]
export const WEEK_COLUMNS: Column[] = [L(26), L(21), R(10), R(6)]
export const WHY_COLUMNS: Column[] = [L(26), L(21), R(9), R(7)]
export const TAB_LABELS = ['Now', 'Session', 'Week', 'Why', 'Help']

// The cost cell of a model without a price
const UNPRICED = 'unpriced'
// The note under the main table of the Session tab
const COST_NOTE = 'estimate: the requests this mod saw, at API prices. /cost: the figure of Claude Code. It also counts requests that the mod does not see, for example compaction.'
const MAX_BAND_MODELS = 1
const BAND_TUBE_CELLS = 10
// The band keeps these free cells, because the proportional font of the desktop app does not match the cell count
const BAND_MARGIN = 4
const NOW_TUBE_CELLS = 8
const BAR_CELLS = 20
// A day of the week history is 2 cells of 12 hours
const DAY_CELLS = 2
const CAUSES: Cause[] = ['start', 'growth', 'resume']

// The columns that go first when the pane is narrower than the table: the indexes, in order
const NOW_DROP = [3, 2, 5, 4]
const SESSION_DROP = [3, 2, 4, 6, 8]
const CAUSE_DROP = [1, 2]
const HISTORY_DROP = [0]
const WEEK_DROP = [1]
const WEEK_HEAD_DROP = [2]
const WHY_DROP = [1, 3]

// limits is the limits alone, limitsAge the `(2h ago)` of an old reading, models the model with the highest cost, more the `+2 models` of the others
export type BandData = { fraction: number | null; stage: Stage | null; label: string; limits: string; limitsAge: string; context: string; models: string; more: string }

export type SessionData = {
  rows: Row[]
  total: Counts
  causes: Causes
  requestTimes: number[]
  resumes: Resume[]
  now: number
  usd: number | null
}

export type WeekData = {
  percent: number | null
  resetAt: number | null
  projection: string
  // The start of the week: the weekday of the first history cell
  start: number
  history: HistoryCell[]
  byRepo: Share[]
  byModelScope: Share[]
  total: number
}

function text(E: Els, value: string, style: Record<string, unknown> = {}): unknown {
  return E.Text({ ...style, children: [value] })
}

function share(part: number, whole: number): string {
  return whole > 0 ? formatPercent(Math.round((part / whole) * 100)) : ''
}

export function bandData(main: Main, totals: Totals, limits: Limit[], limitsAt: number | null, now: number): BandData | null {
  const f = fraction(main.lastRequestAt, now, main.isWorking)
  const stage = f === null ? null : stageOf(f, main.isWorking)
  // The re-warm cost of a model without a price is left out; a cost from a fallback price shows with ≈
  const info = priceInfo(main.model)
  const label = stage === null ? '' : tubeLabel(stage, main.lastRequestAt, now, main.contextTokens, info === undefined ? null : rewarmCost(main.model, main.contextTokens), info?.source === 'fallback')
  const limitsLine = limitsText(limits, null, now)
  const { models, more } = bandModels(totals)
  if (f === null && limitsLine === '' && models === '') return null
  // The tube label already names the context size
  const context = stage === null && main.contextTokens > 0 ? formatTokens(main.contextTokens) : ''
  return { fraction: f, stage, label, limits: limitsLine, limitsAge: limitsLine === '' ? '' : limitsAgeText(limitsAt, now), context, models, more }
}

// The model with the highest cost, and the count of the others: `+1 model`, `+2 models`
function bandModels(totals: Totals): { models: string; more: string } {
  const sorted = [...modelSums(totals)].sort((a, b) => b.counts.cost - a.counts.cost)
  const others = sorted.length - MAX_BAND_MODELS
  return { models: modelsText(sorted.slice(0, MAX_BAND_MODELS)), more: others > 0 ? '+' + others + (others === 1 ? ' model' : ' models') : '' }
}

export function weekData(snaps: Snapshot[], now: number): WeekData {
  const readings = mergeReadings(snaps)
  const week = weekOf(readings, now)
  const groups = groupWeek(snaps, week.start, now)
  return {
    percent: week.percent,
    resetAt: week.resetAt,
    projection: projectionText(week.percent, week.start, now, week.resetAt),
    start: week.start,
    history: historyCells(readings, week.start, now),
    ...groups,
  }
}

function nowStage(r: NowRow, now: number): { f: number | null; stage: Stage | null; minutes: string } {
  const f = fraction(r.lastMainRequestAt, now, r.isWorking)
  const stage = f === null ? null : stageOf(f, r.isWorking)
  const isCounting = stage === 'HOT' || stage === 'WARM' || stage === 'COOLING'
  return { f, stage, minutes: isCounting && r.lastMainRequestAt !== null ? minutesLeft(r.lastMainRequestAt, now) + 'm' : '' }
}

// The cache column as text: 8 tube cells, space, stage padded to 7, space, minutes right-aligned in 4; cell() pads it to 22
export function nowCells(r: NowRow, now: number): string[] {
  const { f, stage, minutes } = nowStage(r, now)
  const cache = f === null || stage === null ? '' : tubeCells(f, NOW_TUBE_CELLS).map((c) => c.char).join('') + ' ' + stage.padEnd(7) + ' ' + minutes.padStart(4)
  // A row without a request has no model yet; a model without a price shows its cost as unpriced
  const isUnpriced = r.model !== '' && priceInfo(r.model) === undefined
  return [cache, r.repo, r.model === '' ? '' : shortModel(r.model), formatTokens(r.contextTokens), isUnpriced ? UNPRICED : formatMoney(r.last60), isUnpriced ? UNPRICED : formatMoney(r.today)]
}

export function sessionCells(r: Row, total: Counts): string[] {
  const c = r.counts
  const info = priceInfo(r.model)
  const isUnpriced = info === undefined
  const isEstimated = info?.source === 'fallback'
  // A cost from a fallback price marks the model name with ≈. The Now cells and the total mix models, so they have no mark
  return [isEstimated ? markedCell(shortModel(r.model), SESSION_COLUMNS[0]) : shortModel(r.model), r.scope, String(c.requests), formatTokens(c.input), formatTokens(c.cacheWrite), formatTokens(c.cacheRead), formatTokens(c.output), isUnpriced ? UNPRICED : formatMoney(c.cost), isUnpriced ? '' : share(c.cost, total.cost)]
}

// On the desktop the tube is one SVG: the cells of the terminal tube are not one width in a proportional font
function isDesktop(E: Els, surface: string): boolean {
  return surface === 'desktop' && E.Svg !== undefined
}

// The band tube has its own size. The tube of a table cell has none, so the surface scales it to the box and it cannot overlap the next column
function tubeSvgEl(E: Els, f: number, n: number, isSized: boolean): unknown {
  const props = { source: barSvg(f, n), alt: tubeAlt(f) }
  return E.Svg!(isSized ? { ...props, width: n * 9, height: 14 } : props)
}

// One Text for each tube cell: empty cells are dimmed. A cell is a block glyph, a graphic, so it keeps the colour of heat
export function cellTexts(E: Els, cells: Cell[]): unknown[] {
  return cells.map((c) => (c.isEmpty ? text(E, c.char, { dimColor: true }) : text(E, c.char, { color: c.color })))
}

export function tubeEls(E: Els, f: number, n: number, isFramed: boolean, surface: string = 'terminal'): unknown[] {
  if (isDesktop(E, surface)) return [tubeSvgEl(E, f, n, isFramed)]
  const parts: unknown[] = []
  if (isFramed) parts.push(text(E, '▕', { dimColor: true }))
  parts.push(...cellTexts(E, tubeCells(f, n)))
  if (isFramed) parts.push(text(E, '▏', { dimColor: true }))
  return parts
}

// An Svg has no width of its own: the Box gives it the width of its cells in the monospace metric, and the markup scales to it
export function svgBox(E: Els, source: string, alt: string, cells: number): unknown {
  return E.Box({ width: cells, flexShrink: 0, children: [E.Svg!({ source, alt })] })
}

// Spaces fill the part of a column that the cells leave
function padTo(E: Els, parts: unknown[], used: number, width: number): unknown[] {
  return width > used ? [...parts, text(E, ' '.repeat(width - used))] : parts
}

// The children of a column box of the given width that holds a bar of n cells
export function barEls(E: Els, f: number, n: number, width: number, alt: string, surface: string = 'terminal'): unknown[] {
  if (isDesktop(E, surface)) return [svgBox(E, barSvg(f, n), alt, n)]
  return padTo(E, cellTexts(E, tubeCells(f, n)), n, width)
}

// The cache strip: warm cells in their colour, cold cells dimmed, a space where no request came before
export function stripEls(E: Els, cells: StripCell[], width: number, alt: string, surface: string = 'terminal'): unknown[] {
  if (isDesktop(E, surface)) return [svgBox(E, stripSvg(cells), alt, cells.length)]
  const texts = cells.map((c) => (c.color === '' ? text(E, ' ') : c.char === '█' ? text(E, c.char, { color: c.color }) : text(E, c.char, { dimColor: true })))
  return padTo(E, texts, cells.length, width)
}

// The week history: a column in its heat colour (a block glyph is a graphic), a dimmed empty cell for a past period without a reading, a dimmed dot for a future period
export function sparkEls(E: Els, cells: HistoryCell[], width: number, alt: string, surface: string = 'terminal'): unknown[] {
  if (isDesktop(E, surface)) return [svgBox(E, sparkSvg(cells), alt, cells.length)]
  const texts = cells.map((c) => {
    if (c.percent !== null) return text(E, c.char, { color: heat(c.percent / 100) })
    return text(E, c.isFuture ? '·' : '░', { dimColor: true })
  })
  return padTo(E, texts, cells.length, width)
}

// The day axis under the week history: the name of each day over its 2 cells, dimmed.
// On the desktop each name is a Box of 2 cells, because a proportional font does not place padded text under the cells
export function dayAxisEls(E: Els, names: string[], width: number, surface: string = 'terminal'): unknown[] {
  // On the desktop the letters have different widths, so each letter sits in the middle of the 2 cells of its day
  if (isDesktop(E, surface)) return names.map((name) => E.Box({ width: DAY_CELLS, flexShrink: 0, justifyContent: 'center', children: [text(E, name.trim(), { dimColor: true })] }))
  const texts = names.map((name) => text(E, name, { dimColor: true }))
  return padTo(E, texts, names.length * DAY_CELLS, width)
}

// The optional parts of the band, in the order that they leave when the band is too wide: from the right
const BAND_DROP = ['more', 'models', 'context', 'age', 'limits'] as const
type BandPart = (typeof BAND_DROP)[number]
type Segment = { value: string; style?: Record<string, unknown> }

const dim = (value: string): Segment => ({ value, style: { dimColor: true } })

// The text of the band after the tube: the stage word (in the text colour of heat), its label and the parts in `shown`, with a separator between them
function bandSegments(d: BandData, shown: Set<BandPart>): Segment[] {
  const segments: Segment[] = []
  if (d.fraction !== null && d.stage !== null) segments.push({ value: ' ' }, { value: d.stage, style: { bold: true, color: heatText(d.fraction) } }, dim(' ' + d.label))
  const add = (prefix: string, ...group: Segment[]) => {
    if (group[0].value === '') return
    if (segments.length > 0) segments.push(dim(' | '))
    if (prefix !== '') segments.push(dim(prefix))
    segments.push(...group)
  }
  add('', { value: shown.has('limits') ? (shown.has('age') ? d.limits + ' ' + d.limitsAge : d.limits) : '' })
  add('ctx ', { value: shown.has('context') ? d.context : '' })
  add('', { value: shown.has('models') ? d.models : '' }, ...(shown.has('more') ? [dim(' ' + d.more)] : []))
  return segments
}

function cellCount(value: string): number {
  return Array.from(value).length
}

// The band is one line of cells: the tube (with the two frame cells on the terminal) and the characters of the text
export function bandEls(E: Els, d: BandData, surface: string = 'terminal', available?: number): unknown {
  const isTubeShown = d.fraction !== null && d.stage !== null
  const onDesktop = isTubeShown && isDesktop(E, surface)
  const tubeCellCount = !isTubeShown ? 0 : onDesktop ? BAND_TUBE_CELLS : BAND_TUBE_CELLS + 2
  const budget = typeof available === 'number' && Number.isFinite(available) ? available - BAND_MARGIN : Infinity
  const widthOf = (segments: Segment[]) => tubeCellCount + segments.reduce((sum, s) => sum + cellCount(s.value), 0)
  const present: Record<BandPart, boolean> = { more: d.models !== '' && d.more !== '', models: d.models !== '', context: d.context !== '', age: d.limits !== '' && d.limitsAge !== '', limits: d.limits !== '' }
  const shown = new Set<BandPart>(BAND_DROP.filter((part) => present[part]))
  let segments = bandSegments(d, shown)
  // Leave out parts from the right until the band fits. The tube, the stage word and the label stay, and so does the last text of a band without a tube
  for (const part of BAND_DROP) {
    if (widthOf(segments) <= budget) break
    if (!shown.has(part)) continue
    shown.delete(part)
    const rest = bandSegments(d, shown)
    if (rest.length === 0) {
      shown.add(part)
      break
    }
    segments = rest
  }
  const parts = segments.map((s) => text(E, s.value, s.style))
  if (isTubeShown && !onDesktop) parts.unshift(...tubeEls(E, d.fraction!, BAND_TUBE_CELLS, true, surface))
  const line = E.Text({ wrap: 'truncate-end', children: parts })
  if (!onDesktop) return line
  const tube = E.Box({ flexShrink: 0, children: tubeEls(E, d.fraction!, BAND_TUBE_CELLS, true, surface) })
  // A Text takes no flex props, so a Box with flexShrink 1 holds the text that is cut
  return E.Box({ flexDirection: 'row', alignItems: 'center', children: [tube, E.Box({ flexShrink: 1, children: [line] })] })
}

type TableOptions = { headerRows?: number; boldRows?: number[]; dimRows?: number[]; dimColumns?: number[]; selectedRows?: number[]; available?: number; dropOrder?: number[] }

// The background of a selected row: a theme key of Claude Code, so it follows the dark and the light theme
const SELECTED_BACKGROUND = 'selectionBg'

// The style of a string cell: header row, dim row, bold row and selected row, dim column, in this order
function cellStyle(options: TableOptions, ri: number, ci: number): Record<string, unknown> {
  if (ri < (options.headerRows ?? 0) || (options.dimRows ?? []).includes(ri)) return { dimColor: true }
  if ((options.boldRows ?? []).includes(ri) || (options.selectedRows ?? []).includes(ri)) return { bold: true }
  return (options.dimColumns ?? []).includes(ci) ? { dimColor: true } : {}
}

export function tableEls(E: Els, columns: Column[], rows: CellValue[][], options: TableOptions = {}): unknown {
  const kept = fitColumns(columns.map((c) => c.width), options.dropOrder ?? [], options.available)
  return E.Box({
    flexDirection: 'column',
    children: rows.map((r, ri) =>
      E.Box({
        flexDirection: 'row',
        // A selected row has one background on the whole row Box: it covers the Svg of the desktop and the gaps between the columns, and it ends with the table
        ...((options.selectedRows ?? []).includes(ri) ? { backgroundColor: SELECTED_BACKGROUND, width: kept.reduce((sum, ci) => sum + columns[ci].width, 0), flexShrink: 0 } : {}),
        children: kept.map((ci) => {
          const column = columns[ci]
          const value = r[ci] ?? ''
          return E.Box({
            width: column.width,
            flexShrink: 0,
            flexDirection: 'row',
            justifyContent: column.align === 'right' ? 'flex-end' : 'flex-start',
            children: typeof value === 'string' ? [text(E, cell(value, column), cellStyle(options, ri, ci))] : value,
          })
        }),
      }),
    ),
  })
}

export function tabsEls(E: Els, current: number, onTab: (n: number) => unknown): unknown {
  return E.Box({
    flexDirection: 'row',
    columnGap: 3,
    children: TAB_LABELS.map((label, i) =>
      E.Button({ key: 'tab-' + (i + 1), label, hotkey: String(i + 1), plain: true, dimColor: current !== i + 1, onPress: () => onTab(i + 1) }),
    ),
  })
}

// The cache column is four boxes of fixed width: tube 8, stage 8, minutes 5 and a spacer of 1. The stage word is text, so it has the text colour of heat
function cacheEls(E: Els, f: number, stage: Stage, minutes: string, surface: string): unknown {
  const color = heatText(f)
  return [
    E.Box({ width: 8, flexShrink: 0, flexDirection: 'row', children: tubeEls(E, f, NOW_TUBE_CELLS, false, surface) }),
    E.Box({ width: 8, flexShrink: 0, flexDirection: 'row', children: [text(E, (' ' + stage).padEnd(8), { bold: true, color })] }),
    E.Box({ width: 5, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', children: [text(E, minutes.padStart(5), { dimColor: true })] }),
    E.Box({ width: 1, flexShrink: 0, flexDirection: 'row', children: [text(E, ' ')] }),
  ]
}

export function nowEls(E: Els, rows: NowRow[], now: number, surface: string = 'terminal', available?: number): unknown {
  if (rows.length === 0) return text(E, 'No session has written data in the last 24 hours.', { dimColor: true })
  const header: CellValue[] = ['cache', 'repo', 'model', 'ctx', '60 min', 'today']
  const body = rows.map((r) => {
    const cells: CellValue[] = nowCells(r, now)
    const { f, stage, minutes } = nowStage(r, now)
    if (f !== null && stage !== null) cells[0] = cacheEls(E, f, stage, minutes, surface) as unknown[]
    return cells
  })
  // The current session is the selected row: the header is row 0, so the index of a row is its place in the list plus 1
  const selectedRows = rows.flatMap((r, i) => (r.isCurrent ? [i + 1] : []))
  return tableEls(E, NOW_COLUMNS, [header, ...body], { headerRows: 1, selectedRows, available, dropOrder: NOW_DROP })
}

function mainTable(E: Els, d: SessionData, available: number | undefined): unknown {
  const header = ['model', 'scope', 'req', 'input', 'c.write', 'c.read', 'output', 'cost', 'share']
  const rows = d.rows.map((r) => sessionCells(r, d.total))
  const t = d.total
  // The total is the estimate of the mod: its scope cell is dimmed and the rest of the row is bold
  const total: CellValue[] = ['total', [text(E, cell('estimate', SESSION_COLUMNS[1]), { dimColor: true })], String(t.requests), formatTokens(t.input), formatTokens(t.cacheWrite), formatTokens(t.cacheRead), formatTokens(t.output), formatMoney(t.cost), '']
  // The cost that Claude Code reports with /cost sits under the cost column, after the total
  const reported = d.usd === null ? [] : [['reported', 'by /cost', '', '', '', '', '', formatMoney(d.usd), '']]
  return tableEls(E, SESSION_COLUMNS, [header, ...rows, total, ...reported], { headerRows: 1, boldRows: [rows.length + 1], dimRows: reported.length > 0 ? [rows.length + 2] : [], available, dropOrder: SESSION_DROP })
}

// The alt of a bar that shows a part of a whole
function shareAlt(part: number): string {
  return 'share ' + formatPercent(Math.round(part * 100))
}

function causeTable(E: Els, causes: Causes, available: number | undefined, surface: string): unknown {
  const writeCost = CAUSES.reduce((sum, key) => sum + causes[key].cost, 0)
  const rows = CAUSES.map((key) => {
    const part = writeCost > 0 ? causes[key].cost / writeCost : 0
    return [key, barEls(E, part, BAR_CELLS, CAUSE_COLUMNS[1].width, shareAlt(part), surface), formatTokens(causes[key].tokens), formatMoney(causes[key].cost), formatPercent(Math.round(part * 100))]
  })
  return tableEls(E, CAUSE_COLUMNS, [['cache writes', '', 'tokens', 'cost', 'share'], ...rows], { headerRows: 1, available, dropOrder: CAUSE_DROP })
}

// A piece of text at a cell offset of a row: its parts follow each other from the cell `at`
type Piece = { at: number; parts: { text: string; style: Record<string, unknown> }[] }

// The resume mark is a text mark next to its cost, so it has the text colour of heat
const MARK_STYLE = { color: heatText(1) }
const AXIS_STYLE = { dimColor: true }
const AXIS_HOURS = 4

// The pieces of a row in a column of `width` cells, each at its cell offset.
// The desktop font is proportional, so a Text could not place a piece by spaces: each piece gets a Box of fixed width that runs to the next piece or to the end of the column.
// The terminal places the pieces with text cells.
function offsetEls(E: Els, pieces: Piece[], width: number, surface: string): unknown[] {
  const parts = (piece: Piece) => piece.parts.map((part) => text(E, part.text, part.style))
  if (isDesktop(E, surface)) {
    const lead = pieces[0].at > 0 ? [E.Box({ width: pieces[0].at, flexShrink: 0, children: [] })] : []
    return [...lead, ...pieces.map((piece, i) => E.Box({ width: (pieces[i + 1]?.at ?? width) - piece.at, flexShrink: 0, flexDirection: 'row', children: parts(piece) }))]
  }
  const els: unknown[] = []
  let used = 0
  for (const piece of pieces) {
    if (piece.at > used) els.push(text(E, ' '.repeat(piece.at - used)))
    els.push(...parts(piece))
    used = piece.at + piece.parts.reduce((sum, part) => sum + Array.from(part.text).length, 0)
  }
  return padTo(E, els, used, width)
}

// The row of the resumes: a mark in the cell of each resume, with its cost when it fits, and the list of the other costs
function resumePieces(placed: PlacedMarks): Piece[] {
  const pieces: Piece[] = placed.marks.map((m) => ({ at: m.cell, parts: [{ text: '▲', style: MARK_STYLE }, ...(m.cost === null ? [] : [{ text: ' ' + m.cost, style: {} }])] }))
  if (placed.list !== null) pieces.push({ at: placed.list.at, parts: [{ text: placed.list.text, style: {} }] })
  return pieces.sort((a, b) => a.at - b.at)
}

// The time axis: a label at the first cell of each hour before now, and `now` ending at the last cell of the strip
function axisPieces(cells: number): Piece[] {
  const hour = cells / AXIS_HOURS
  const pieces = Array.from({ length: AXIS_HOURS }, (_, i): Piece => ({ at: i * hour, parts: [{ text: '-' + (AXIS_HOURS - i) + ' h', style: AXIS_STYLE }] }))
  return [...pieces, { at: cells - 'now'.length, parts: [{ text: 'now', style: AXIS_STYLE }] }]
}

// The cache history in the columns of the cause table: the strip, the resumes at their cells and the time axis
function historyGrid(E: Els, d: SessionData, available: number | undefined, surface: string): unknown {
  const width = HISTORY_COLUMNS[1].width
  const cells = stripCells(d.requestTimes, d.now)
  // The state drops old resumes only at the next request, so the strip window decides which resumes count
  const marks = d.resumes
    .filter((r) => r.at > d.now - STRIP_MS)
    .flatMap((r): ResumeMark[] => {
      const index = stripCellAt(r.at, d.now)
      return index === null ? [] : [{ cell: index, cost: formatMoney(r.cost) }]
    })
  const rows: CellValue[][] = [['cache, last 4 h', stripEls(E, cells, width, 'cache history of the last 4 hours', surface)]]
  if (marks.length > 0) rows.push(['resumes', offsetEls(E, resumePieces(placeMarks(marks, width)), width, surface)])
  rows.push(['', offsetEls(E, axisPieces(cells.length), width, surface)])
  return tableEls(E, HISTORY_COLUMNS, rows, { dimColumns: [0], available, dropOrder: HISTORY_DROP })
}

export function sessionEls(E: Els, d: SessionData, available?: number, surface: string = 'terminal'): unknown {
  if (d.rows.length === 0) return text(E, 'No model request in this session yet.', { dimColor: true })
  // The note explains the two amounts under the main table. It is one Text that wraps to the pane width, and it shows with the reported row
  const note = d.usd === null ? [] : [text(E, COST_NOTE, { dimColor: true, wrap: 'wrap' })]
  return E.Box({ flexDirection: 'column', children: [mainTable(E, d, available), ...note, text(E, ' '), causeTable(E, d.causes, available, surface), text(E, ' '), historyGrid(E, d, available, surface)] })
}

function shareTable(E: Els, title: string, rows: Share[], total: number, available: number | undefined, surface: string): unknown {
  const body = rows.map((r) => {
    const part = total > 0 && !r.isUnpriced ? r.cost / total : 0
    const alt = r.isUnpriced ? UNPRICED : shareAlt(part)
    return [r.isEstimated ? markedCell(r.name, WEEK_COLUMNS[0]) : r.name, barEls(E, part, BAR_CELLS, WEEK_COLUMNS[1].width, alt, surface), r.isUnpriced ? UNPRICED : formatMoney(r.cost), r.isUnpriced ? '' : share(r.cost, total)]
  })
  return tableEls(E, WEEK_COLUMNS, [[title, '', 'cost', 'share'], ...body], { headerRows: 1, available, dropOrder: WEEK_DROP })
}

function historyAlt(history: HistoryCell[]): string {
  const percents = history.flatMap((h) => (h.percent === null ? [] : [h.percent]))
  return 'week history' + (percents.length > 0 ? ', highest ' + Math.round(Math.max(...percents)) + '%' : '')
}

// The limit, its reset, the projection and the history, as a grid in the columns of the share tables
function weekHead(E: Els, d: WeekData, available: number | undefined, surface: string): unknown {
  const [, meter, , value] = WEEK_COLUMNS
  const rows: CellValue[][] = []
  if (d.percent === null) {
    rows.push(['week', 'n/a'])
  } else {
    const percent = [text(E, cell(formatPercent(d.percent), value), { bold: true, color: heatText(d.percent / 100) })]
    rows.push(['week', barEls(E, d.percent / 100, BAR_CELLS, meter.width, 'week ' + Math.round(d.percent) + '% used', surface), '', percent])
  }
  if (d.resetAt !== null) rows.push(['resets', dayTime(d.resetAt)])
  if (d.projection !== '') rows.push(['at the current rate', d.projection])
  if (d.history.some((h) => h.percent !== null)) {
    rows.push(['week used, over time', sparkEls(E, d.history, meter.width, historyAlt(d.history), surface)])
    rows.push(['', dayAxisEls(E, weekDayNames(d.start), meter.width, surface)])
  }
  return tableEls(E, WEEK_COLUMNS, rows, { dimColumns: [0], dimRows: d.percent === null ? [0] : [], available, dropOrder: WEEK_HEAD_DROP })
}

export function weekEls(E: Els, d: WeekData, available?: number, surface: string = 'terminal'): unknown {
  const lines = [weekHead(E, d, available, surface), text(E, ' '), shareTable(E, 'by repo', d.byRepo, d.total, available, surface), text(E, ' '), shareTable(E, 'by model and scope', d.byModelScope, d.total, available, surface)]
  return E.Box({ flexDirection: 'column', children: lines })
}

function whyContext(E: Els, b: Breakdown, available: number | undefined, surface: string): unknown {
  const [, meter, tokens, percent] = WHY_COLUMNS
  const ratio = b.max > 0 ? b.total / b.max : 0
  const alt = b.max > 0 ? 'context ' + Math.round(ratio * 100) + '% used' : 'context size unknown'
  const row: CellValue[] = [
    b.max > 0 ? 'context of ' + formatTokens(b.max) : 'context',
    barEls(E, ratio, BAR_CELLS, meter.width, alt, surface),
    [text(E, cell(formatTokens(b.total), tokens), { bold: true })],
    b.max > 0 ? [text(E, cell(formatPercent(Math.round(ratio * 100)), percent), { bold: true, color: heatText(ratio) })] : '',
  ]
  return tableEls(E, WHY_COLUMNS, [row], { dimColumns: [0], available, dropOrder: WHY_DROP })
}

function whyCategories(E: Els, b: Breakdown, available: number | undefined, surface: string): unknown {
  const rows = b.categories.map((c) => {
    const part = b.total > 0 ? c.tokens / b.total : 0
    return [c.name, barEls(E, part, BAR_CELLS, WHY_COLUMNS[1].width, shareAlt(part), surface), formatTokens(c.tokens), share(c.tokens, b.total)]
  })
  return tableEls(E, WHY_COLUMNS, [['category', '', 'tokens', 'share'], ...rows], { headerRows: 1, available, dropOrder: WHY_DROP })
}

// A list has no bar: its name column takes the room of the bar column, and the share column goes with the share of the grid
function whyList(E: Els, title: string, rows: { name: string; tokens: number }[], total: number, columns: Column[]): unknown[] {
  if (rows.length === 0) return []
  const body = rows.map((r) => [r.name, formatTokens(r.tokens), share(r.tokens, total)])
  return [text(E, ' '), tableEls(E, columns, [[title, 'tokens', 'share'], ...body], { headerRows: 1 })]
}

export function whyEls(E: Els, b: Breakdown | null, available?: number, surface: string = 'terminal'): unknown {
  if (b === null) return text(E, 'Reading the context breakdown…', { dimColor: true })
  const [label, meter, tokens, percent] = WHY_COLUMNS
  const kept = fitColumns(WHY_COLUMNS.map((c) => c.width), WHY_DROP, available)
  const listColumns = [L(label.width + (kept.includes(1) ? meter.width : 0)), tokens, ...(kept.includes(3) ? [percent] : [])]
  return E.Box({
    flexDirection: 'column',
    children: [
      whyContext(E, b, available, surface),
      text(E, ' '),
      whyCategories(E, b, available, surface),
      ...whyList(E, 'largest memory files', b.memoryFiles, b.total, listColumns),
      ...whyList(E, 'MCP servers', b.mcpServers, b.total, listColumns),
      ...whyList(E, 'custom agents', b.agents, b.total, listColumns),
    ],
  })
}

// Tab 5 is static text: one row for each term of the band and the tabs, drawn as it shows there, and the line that explains it.
// A term reads as the label that the band or a tab draws. Change a label there and the term here together
const HELP_TERM_WIDTH = 22
// The narrowest explanation column. A narrower pane still shows all of the text, in short lines
const HELP_MIN_TEXT = 12
// The tube of the first row: 10 cells, 40% of the cache hour left
const HELP_TUBE_FRACTION = 0.4
// A fraction inside the range of each stage, for the colour of its word
const HELP_STAGE_FRACTIONS: Record<Stage, number> = { LIVE: 1, HOT: 0.9, WARM: 0.5, COOLING: 0.2, COLD: 0 }

// How a term is drawn when it is not plain text: the tube of the band (no text), a stage word, the selected row of tab 1, the resume mark of tab 2
type HelpLook = 'tube' | 'stage' | 'selected' | 'resume'
type HelpEntry = { term: string; text: string; look?: HelpLook }
type HelpSection = { title: string; entries: HelpEntry[] }

const HELP: HelpSection[] = [
  {
    title: 'Band above the prompt',
    entries: [
      { term: '', look: 'tube', text: 'Cache of this conversation. Full after each request, empty after 60 minutes. Blue is cold, red is hot.' },
      { term: 'LIVE', look: 'stage', text: 'A turn runs.' },
      { term: 'HOT', look: 'stage', text: 'More than 2/3 of the cache hour is left.' },
      { term: 'WARM', look: 'stage', text: '1/3 to 2/3 of the hour is left.' },
      { term: 'COOLING', look: 'stage', text: 'Less than 1/3 of the hour is left.' },
      { term: 'COLD', look: 'stage', text: 'The cache expired. The next message writes it again.' },
      { term: '47m left', text: 'Minutes until the cache expires.' },
      { term: '412k cached', text: 'Tokens in the cache: the context.' },
      { term: '$8.24 to re-warm', text: 'What the next message costs to write them again.' },
      { term: 'week 41% · 5h 12%', text: 'Plan limits used, as Claude Code reports them.' },
      { term: 'r31M w1.2M o120k', text: 'The costliest model: cache read, cache write, output.' },
      { term: '+1 model', text: 'More models ran. The Session tab lists all of them.' },
    ],
  },
  {
    title: '1 Now',
    entries: [
      { term: 'highlighted row', look: 'selected', text: 'This session.' },
      { term: 'ctx', text: 'Context tokens of the last request.' },
      { term: '60 min, today', text: 'Cost in the last 60 minutes and since midnight.' },
    ],
  },
  {
    title: '2 Session',
    entries: [
      { term: 'scope', text: 'main, or the type of a subagent.' },
      { term: 'req, input', text: 'Requests, and input tokens outside the cache.' },
      { term: 'c.write, c.read', text: 'Tokens written to and read from the cache.' },
      { term: 'estimate', text: 'Total at API prices, from the requests this mod saw.' },
      { term: 'reported', text: 'The cost that Claude Code reports with /cost.' },
      { term: 'start', text: 'Cache write of the first request of a thread.' },
      { term: 'growth', text: 'Cache write of new context in a running thread.' },
      { term: 'resume', text: 'Cache write after a pause longer than the cache life.' },
      { term: 'cache, last 4 h', text: 'One cell per 5 minutes. Colour: warm. Dark: cold.' },
      { term: '▲ $3.37', look: 'resume', text: 'A resume and the cost of its cache write.' },
    ],
  },
  {
    title: '3 Week',
    entries: [
      { term: 'week, resets', text: 'Weekly limit used, and when it resets.' },
      { term: 'at the current rate', text: 'When the week reaches 100% at the pace so far.' },
      { term: 'week used, over time', text: 'One cell per 12 hours: the highest weekly percent. Outlines are the periods still to come.' },
      { term: 'by repo, by model', text: 'Cost since the weekly reset.' },
    ],
  },
  {
    title: '4 Why',
    entries: [{ term: 'context', text: 'What fills it: categories, memory files, MCP servers and agents, estimated as /context does.' }],
  },
  {
    title: 'Costs',
    entries: [
      { term: 'every cost', text: 'An estimate at API list prices. A plan does not bill them. They show where the tokens go.' },
      { term: 'opus-5-6 ≈', text: 'No exact price yet: priced as the newest model of its family. make prices lists these models.' },
      { term: 'unpriced', text: 'The model has no price in the table of the mod.' },
    ],
  },
]

// The elements of a term, in the style of the place where it shows
function helpTermEls(E: Els, entry: HelpEntry, surface: string): unknown[] {
  switch (entry.look) {
    case 'tube': {
      // The band tube has a frame on the terminal. On the desktop it is an Svg in a Box of its cells, as in a table
      const onDesktop = isDesktop(E, surface)
      const tube = tubeEls(E, HELP_TUBE_FRACTION, BAND_TUBE_CELLS, !onDesktop, surface)
      return onDesktop ? [E.Box({ width: BAND_TUBE_CELLS, flexShrink: 0, children: tube })] : tube
    }
    case 'stage':
      return [text(E, entry.term, { bold: true, color: heatText(HELP_STAGE_FRACTIONS[entry.term as Stage]) })]
    case 'selected':
      // The background sits on a Box around the text, as on the selected row of tab 1
      return [E.Box({ flexShrink: 0, backgroundColor: SELECTED_BACKGROUND, children: [text(E, entry.term, { bold: true })] })]
    case 'resume': {
      const [mark, ...rest] = Array.from(entry.term)
      return [text(E, mark, MARK_STYLE), text(E, rest.join(''))]
    }
    default:
      return [text(E, entry.term)]
  }
}

// One row: the term in a column of fixed width, and the explanation in the room that is left. The explanation wraps, so a narrow pane cuts nothing
function helpRow(E: Els, entry: HelpEntry, room: number | undefined, surface: string): unknown {
  return E.Box({
    flexDirection: 'row',
    children: [
      E.Box({ width: HELP_TERM_WIDTH, flexShrink: 0, flexDirection: 'row', children: helpTermEls(E, entry, surface) }),
      E.Box({ flexShrink: 1, ...(room === undefined ? {} : { width: room }), children: [text(E, entry.text, { wrap: 'wrap' })] }),
    ],
  })
}

// Tab 5: the sections with a bold heading each, a blank line between them
export function helpEls(E: Els, available?: number, surface: string = 'terminal'): unknown {
  const room = typeof available === 'number' && Number.isFinite(available) ? Math.max(HELP_MIN_TEXT, available - HELP_TERM_WIDTH) : undefined
  const lines = HELP.flatMap((section, i) => [...(i > 0 ? [text(E, ' ')] : []), text(E, section.title, { bold: true }), ...section.entries.map((entry) => helpRow(E, entry, room, surface))])
  return E.Box({ flexDirection: 'column', children: lines })
}

export function paneEls(E: Els, tabs: unknown, body: unknown): unknown {
  return E.Box({ flexDirection: 'column', children: [tabs, text(E, ' '), body] })
}
