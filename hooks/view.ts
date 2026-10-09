import type { Breakdown, Cause, Causes, Counts, Limit, Main, MainRequest, Recommend, Resume, Snapshot } from '../types'
import { actionOf, weekRange, type Action } from './advice'
import { cell, dayTime, desktopCells, fitColumns, formatMoney, formatPercent, formatTokens, historyCells, limitsAgeText, markedCell, placeMarks, projectionText, shortModel, tubeParts, unknownLabel, UNKNOWN_LIFE, weekDayNames, type Column, type HistoryCell, type PlacedMarks, type ResumeMark } from './format'
import { priceInfo, rewarmCost } from './prices'
import { RECOMMEND_SCOPE, priceSourceOf } from './recommend'
import { barSvg, defaultTtl, fraction, heat, heatText, minutesLeft, sparkSvg, stageOf, stripCellAt, stripCells, stripSvg, tubeAlt, tubeCells, type Cell, type Stage, type StripCell } from './temperature'
import { STRIP_MS, groupWeek, mergeReadings, weekOf, type NowRow, type Row, type Share } from './tally'

type El = (props: Record<string, any>) => unknown
// Svg exists only in the element table of the remote surfaces. Markdown is in every table; the tests of the tabs leave it out
export type Els = { Box: El; Text: El; Button: El; Svg?: El; Markdown?: El }
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
const BAND_TUBE_CELLS = 10
// The desktop tube is an Svg of 90 by 14 CSS pixels: 11.6 cells of the code font of the desktop app
const BAND_DESKTOP_TUBE_CELLS = 12
// The band keeps these free cells, a margin for the width estimate of the proportional font on the desktop
const BAND_MARGIN = 4
// The two buttons at the right end of the band: 2 cells of gap, `[ details ]` (the longer label of the pane button), 2 cells of gap and the hide button `×`.
// The band keeps these cells, so the buttons stay when parts of the text leave. On the desktop the native `details` button without a hotkey
// takes about 6.5 cells of the code font and `×` about 1, measured on a screenshot of 2026-10-08, so the same 16 cells hold them
const BAND_BUTTON_GAP = 2
const HIDE_GLYPH = '×'
const BAND_BUTTON_CELLS = BAND_BUTTON_GAP + '[ details ]'.length + BAND_BUTTON_GAP + HIDE_GLYPH.length
// The labels of the pane button, closed and open
const PANE_BUTTON_LABELS = { closed: 'details', open: 'close' } as const
// The key that presses the pane button once the band has the focus, on the terminal only: the desktop draws a hotkey as a badge that takes width, and a click presses the button there.
// A letter, because a bare digit in an empty prompt presses a band button
const PANE_BUTTON_HOTKEY = 't'
// The font table of desktopCells matched the band text of one screenshot to 0.1%, and of two more within 3%.
// The band counts the desktop text 4% wider, so that it leaves out a part before the line wraps
const DESKTOP_TEXT_FACTOR = 1.04
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

// A limit in the band: its name and percent, the heat of the percent when it runs hot (5h full soon, week used up, any limit at 100%) or null,
// the range of the week (`lasts until reset` dimmed, `runs out Fri 14:00` in heat) or null, and isKept for a limit that never leaves: one that the action names or one at 100%
export type BandLimit = { kind: string; name: string; percent: string; heat: number | null; range: { text: string; heat: number | null } | null; isKept: boolean }

// The band as a dashboard. lead never leaves: the minutes, `in turn`, or the label of an unknown cache life. context and price can leave.
// action is the one action of the band, or null. spend replaces the limits with an API key: the cost of the sessions on this Mac today and in the last 60 minutes
export type BandData = {
  fraction: number | null
  stage: Stage | null
  lead: string
  context: string
  price: string
  action: Action | null
  limits: BandLimit[]
  limitsAge: string
  spend: { today: string; perHour: string } | null
}

// The cost of the sessions on this Mac since midnight and in the last 60 minutes, for a session without plan limits (an API key)
export type Spend = { today: number; perHour: number }

export type SessionData = {
  rows: Row[]
  total: Counts
  causes: Causes
  requests: MainRequest[]
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

// The heat of a range that runs out: the colour of a part that runs hot
const RUNS_OUT_HEAT = 0.9
const LIMIT_NAMES: Record<string, string> = { seven_day: 'week', five_hour: '5h', spend_limit: 'spend' }
const LIMIT_ORDER = ['seven_day', 'five_hour', 'spend_limit']

function limitRank(kind: string): number {
  const i = LIMIT_ORDER.indexOf(kind)
  return i === -1 ? LIMIT_ORDER.length : i
}

// The limits of the band: the week with its range, then the 5-hour window and the others. The limit that the action names comes first and keeps its place
function bandLimits(limits: readonly Limit[], limitsAt: number | null, now: number, action: Action | null): BandLimit[] {
  const items = [...limits]
    .sort((a, b) => limitRank(a.kind) - limitRank(b.kind))
    .map((l): BandLimit => {
      const isWeek = l.kind === 'seven_day'
      const range = isWeek ? weekRange(l, limitsAt, now) : null
      const isUsedUp = isWeek && action?.kind === 'weekUsedUp'
      const isFull = l.kind === 'five_hour' && action?.kind === 'fiveHour'
      // A limit at 100% or more runs hot and stays in the band whatever the action
      const isAtLimit = l.percentUsed >= 100
      return {
        kind: l.kind,
        name: LIMIT_NAMES[l.kind] ?? l.kind,
        percent: formatPercent(l.percentUsed),
        heat: isUsedUp || isAtLimit ? 1 : isFull ? l.percentUsed / 100 : null,
        range: range === null ? null : range.kind === 'lasts' ? { text: 'lasts until reset', heat: null } : { text: 'runs out ' + dayTime(range.at), heat: RUNS_OUT_HEAT },
        isKept: isUsedUp || isFull || isAtLimit,
      }
    })
  return action?.kind === 'fiveHour' ? [...items.filter((l) => l.kind === 'five_hour'), ...items.filter((l) => l.kind !== 'five_hour')] : items
}

export function bandData(main: Main, limits: Limit[], limitsAt: number | null, now: number, spend: Spend | null = null): BandData | null {
  const ttl = main.ttl ?? null
  const f = fraction(main.lastRequestAt, now, main.isWorking, ttl)
  const stage = f === null ? null : stageOf(f, main.isWorking)
  // The re-warm cost of a model without a price is left out; a cost from a fallback price shows with ≈.
  // The next message writes with the lifetime of the last one, or with the default before the mod knows it
  const info = priceInfo(main.model)
  const rewarm = info === undefined ? null : rewarmCost(main.model, main.contextTokens, ttl ?? defaultTtl(false))
  // Without a known lifetime the tube shows no countdown, only the time since the last request
  const parts =
    stage !== null
      ? tubeParts(stage, main.lastRequestAt, now, main.contextTokens, rewarm, info?.source === 'fallback', ttl)
      : { lead: main.lastRequestAt === null ? '' : unknownLabel(main.lastRequestAt, now), context: main.lastRequestAt !== null && main.contextTokens > 0 ? ' · ' + formatTokens(main.contextTokens) + ' cached' : '', price: '' }
  const action = actionOf({ main, limits, limitsAt, now })
  const items = bandLimits(limits, limitsAt, now, action)
  const spent = limits.length === 0 && spend !== null && (spend.today > 0 || parts.lead !== '') ? { today: 'today ' + formatMoney(spend.today), perHour: formatMoney(spend.perHour) + '/h' } : null
  if (parts.lead === '' && items.length === 0 && spent === null) return null
  return { fraction: f, stage, ...parts, action, limits: items, limitsAge: items.length === 0 ? '' : limitsAgeText(limitsAt, now), spend: spent }
}

export function weekData(snaps: Snapshot[], now: number): WeekData {
  const readings = mergeReadings(snaps)
  const week = weekOf(readings, now)
  const groups = groupWeek(snaps, week.start, now)
  return {
    percent: week.percent,
    resetAt: week.resetAt,
    projection: projectionText(week.percent, week.start, week.readAt, week.resetAt, now),
    start: week.start,
    history: historyCells(readings, week.start, now),
    ...groups,
  }
}

function nowStage(r: NowRow, now: number): { f: number | null; stage: Stage | null; minutes: string } {
  const f = fraction(r.lastMainRequestAt, now, r.isWorking, r.mainTtl)
  const stage = f === null ? null : stageOf(f, r.isWorking)
  const isCounting = stage === 'HOT' || stage === 'WARM' || stage === 'COOLING'
  return { f, stage, minutes: isCounting && r.lastMainRequestAt !== null && r.mainTtl !== null ? minutesLeft(r.lastMainRequestAt, now, r.mainTtl) + 'm' : '' }
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

// The optional parts of the band, in the order that they leave when the band is too wide.
// calmRange is `lasts until reset`, minorLimits the limits besides the week. A range that runs out, the limit that the action names, the tube,
// the stage word, the lead and the action never leave
const BAND_DROP = ['age', 'calmRange', 'minorLimits', 'price', 'perHour', 'context', 'week', 'today'] as const
type BandPart = (typeof BAND_DROP)[number]
type Segment = { value: string; style?: Record<string, unknown> }

// While an action shows, these parts leave at any width: the action is the one thing to read. A cold cache keeps its price, the cost of the next message
function hiddenByAction(d: BandData): BandPart[] {
  if (d.action === null) return []
  return ['calmRange', 'minorLimits', ...(d.stage === 'COLD' ? [] : (['price'] as BandPart[]))]
}

const dim = (value: string): Segment => ({ value, style: { dimColor: true } })
const heated = (value: string, heat: number | null): Segment => (heat === null ? { value } : { value, style: { color: heatText(heat) } })

// The parts of one limit that show: its name and percent, and its range
function limitGroup(l: BandLimit, shown: Set<BandPart>): Segment[] {
  const isWeek = l.kind === 'seven_day'
  const isNameShown = l.isKept || (isWeek ? shown.has('week') : shown.has('minorLimits'))
  const isRangeShown = l.range !== null && (l.range.heat !== null || shown.has('calmRange'))
  const group: Segment[] = isNameShown ? [{ value: l.name + ' ' }, heated(l.percent, l.heat)] : []
  if (isRangeShown) group.push(...(isNameShown ? [dim(' · ')] : []), l.range!.heat === null ? dim(l.range!.text) : heated(l.range!.text, l.range!.heat))
  return group
}

// The text of the band after the tube: the stage word (in the text colour of heat) and its label, the action, the limits or the spend, with a separator between them
function bandSegments(d: BandData, shown: Set<BandPart>): Segment[] {
  const segments: Segment[] = []
  const label = d.lead + (shown.has('context') ? d.context : '') + (shown.has('context') && shown.has('price') ? d.price : '')
  if (d.fraction !== null && d.stage !== null) segments.push({ value: ' ' }, { value: d.stage, style: { bold: true, color: heatText(d.fraction) } }, dim(' ' + label))
  else if (d.lead !== '') segments.push(dim(label))
  const add = (group: Segment[]) => {
    if (group.length === 0) return
    if (segments.length > 0) segments.push(dim(' | '))
    segments.push(...group)
  }
  if (d.action !== null) add([{ value: d.action.verb, style: { bold: true } }, ...(d.action.rest === '' ? [] : [{ value: d.action.rest }])])
  const groups = d.limits.map((l) => limitGroup(l, shown)).filter((g) => g.length > 0)
  if (groups.length > 0 && shown.has('age') && d.limitsAge !== '') groups[groups.length - 1].push(dim(' ' + d.limitsAge))
  for (const group of groups) add(group)
  if (d.spend !== null) add([...(shown.has('today') ? [{ value: d.spend.today }] : []), ...(shown.has('perHour') ? [dim((shown.has('today') ? ' · ' : '') + d.spend.perHour)] : [])])
  return segments
}

function cellCount(value: string): number {
  return Array.from(value).length
}

// The width of the band in cells: the tube and the text.
// On the terminal the tube is 12 cells (10 and the two frame cells) and each character of the text is one cell.
// On the desktop the tube is the Svg, and the text is proportional, so each character has its own width (desktopCells)
export function bandCells(text: string, isTubeShown: boolean, isOnDesktop: boolean): number {
  const tube = !isTubeShown ? 0 : isOnDesktop ? BAND_DESKTOP_TUBE_CELLS : BAND_TUBE_CELLS + 2
  return tube + (isOnDesktop ? desktopCells(text) * DESKTOP_TEXT_FACTOR : cellCount(text))
}

// The buttons of the band: the label of the pane button, what a press of it runs, and what the hide button runs
export type BandButtons = { isPaneOpen: boolean; onPane: () => unknown; onHide: () => unknown }

// The buttons at the right end. The focus of the band starts on the pane button, so ctrl+x tab and Enter press it, and Tab moves to the hide button.
// The key of the pane button stays when its label changes, so the focus stays on it
function bandButtonEls(E: Els, buttons: BandButtons, isOnDesktop: boolean): unknown[] {
  const label = buttons.isPaneOpen ? PANE_BUTTON_LABELS.open : PANE_BUTTON_LABELS.closed
  const pane = E.Button({ key: 'pane', label, ...(isOnDesktop ? {} : { hotkey: PANE_BUTTON_HOTKEY }), autoFocus: true, dimColor: true, onPress: buttons.onPane })
  // The desktop draws no close mark for the dismiss role in the band: it draws the label, so the label is the glyph on both surfaces
  const hide = E.Button({ key: 'band-hide', label: HIDE_GLYPH, role: 'dismiss', plain: true, dimColor: true, onPress: buttons.onHide })
  return [pane, hide].map((button) => E.Box({ flexShrink: 0, marginLeft: BAND_BUTTON_GAP, children: [button] }))
}

export function bandEls(E: Els, d: BandData, surface: string = 'terminal', available?: number, buttons?: BandButtons): unknown {
  const isTubeShown = d.fraction !== null && d.stage !== null
  const isOnDesktop = isDesktop(E, surface)
  const onDesktop = isTubeShown && isOnDesktop
  const budget = typeof available === 'number' && Number.isFinite(available) ? available - BAND_MARGIN - (buttons === undefined ? 0 : BAND_BUTTON_CELLS) : Infinity
  const widthOf = (segments: Segment[]) => bandCells(segments.map((s) => s.value).join(''), isTubeShown, isOnDesktop)
  const present: Record<BandPart, boolean> = {
    age: d.limits.length > 0 && d.limitsAge !== '',
    calmRange: d.limits.some((l) => l.range !== null && l.range.heat === null),
    minorLimits: d.limits.some((l) => l.kind !== 'seven_day' && !l.isKept),
    price: d.price !== '',
    perHour: d.spend !== null,
    context: d.context !== '',
    week: d.limits.some((l) => l.kind === 'seven_day' && !l.isKept),
    today: d.spend !== null,
  }
  const hidden = hiddenByAction(d)
  const shown = new Set<BandPart>(BAND_DROP.filter((part) => present[part] && !hidden.includes(part)))
  let segments = bandSegments(d, shown)
  // Leave out parts in the drop order until the band fits. The tube, the stage word, the lead and the action stay, and so does the last text of a band without a tube
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
  // A Box that grows between the text and the buttons puts the buttons at the right end
  const right = buttons === undefined ? [] : [E.Box({ flexGrow: 1, children: [] }), ...bandButtonEls(E, buttons, isOnDesktop)]
  // A Text takes no flex props, so a Box with flexShrink 1 holds the text that is cut
  if (!onDesktop) return right.length === 0 ? line : E.Box({ flexDirection: 'row', children: [E.Box({ flexShrink: 1, children: [line] }), ...right] })
  const tube = E.Box({ flexShrink: 0, children: tubeEls(E, d.fraction!, BAND_TUBE_CELLS, true, surface) })
  return E.Box({ flexDirection: 'row', alignItems: 'center', children: [tube, E.Box({ flexShrink: 1, children: [line] }), ...right] })
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
  const cells = stripCells(d.requests, d.now)
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
  // On a subscription the value of the plan, with an API key the spend: the cost of the week at API prices
  if (d.total > 0) rows.push(['at API prices', formatMoney(d.total)])
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
      { term: '', look: 'tube', text: 'Cache of this conversation. Full after each request, empty when the cache life ends: 1 hour or 5 minutes, read from the cost that Claude Code books. Blue is cold, red is hot.' },
      { term: 'LIVE', look: 'stage', text: 'A turn runs.' },
      { term: 'HOT', look: 'stage', text: 'More than 2/3 of the cache life is left.' },
      { term: 'WARM', look: 'stage', text: '1/3 to 2/3 of the cache life is left.' },
      { term: 'COOLING', look: 'stage', text: 'Less than 1/3 of the cache life is left.' },
      { term: 'COLD', look: 'stage', text: 'The cache expired. The next message writes it again.' },
      { term: '47m left', text: 'Minutes until the cache expires.' },
      { term: UNKNOWN_LIFE, text: 'The mod has not read the cache life yet. The band shows the time since the last request, no countdown.' },
      { term: '412k cached', text: 'Tokens in the cache: the context.' },
      { term: '$8.24 to re-warm', text: 'What the next message costs to write them again.' },
      { term: 'send now', text: 'The 1-hour cache expires within 10 minutes, and writing it again costs $1 or more.' },
      { term: '/clear', text: 'The cache is cold, and writing it again costs $1 or more. A new topic is cheaper in a new conversation.' },
      { term: '/compact', text: 'The context has 400k tokens or more, and every message reads all of it.' },
      { term: 'slow down', text: 'At the pace so far the week runs out before its reset. A smaller model uses less of it.' },
      { term: '5h full at 15:31', text: 'At the pace so far the 5-hour limit fills within the hour.' },
      { term: 'week used up', text: 'Past the weekly limit Claude Code bills usage credits and caches for 5 minutes.' },
      { term: 'week 41%', text: 'Weekly plan limit used, as Claude Code reports it.' },
      { term: 'lasts until reset', text: 'At the pace so far the week lasts until its reset.' },
      { term: 'runs out Fri 14:00', text: 'At the pace so far the week runs out at this time, before its reset.' },
      { term: '5h 12%', text: '5-hour plan limit used.' },
      { term: 'today $12.40', text: 'With an API key, in place of the limits: the cost of the sessions on this Mac since midnight.' },
      { term: '$4.10/h', text: 'With an API key: the cost of the last 60 minutes.' },
      { term: '[ details ]', text: 'Opens this pane, and [ close ] closes it. In the terminal: ctrl+x tab, then Enter or t.' },
      { term: '×', text: 'Hides the band in this session. /token-watch band on shows it again. In the terminal: ctrl+x tab, Tab, Enter.' },
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
      { term: 'scope', text: 'main, the type of a subagent, or recommend: the call of /token-watch recommend.' },
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
      { term: 'at API prices', text: 'The cost of the week at API prices: on a subscription, what the same use costs with an API key.' },
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
      { term: 'opus-5-6 ≈', text: 'No exact price yet: priced as the newest model of its family. make price-report lists these models.' },
      { term: 'unpriced', text: 'The model has no price in the table of the mod.' },
    ],
  },
  {
    title: '/token-watch',
    entries: [
      { term: 'no argument', text: 'Opens this pane, or closes it when it is open.' },
      { term: 'band off, band on', text: 'Hides or shows the band in all sessions on this Mac. band on also undoes ×. The mod still counts.' },
      { term: 'recommend', text: 'Asks a model for advice on this usage. A dialog shows the cost first, and the call runs only when you press Ask. On a subscription it counts against the plan allowance.' },
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

// Tab 5: the sections with a bold heading each, a blank line between them. The last section names the forms of the command
export function helpEls(E: Els, available?: number, surface: string = 'terminal'): unknown {
  const room = typeof available === 'number' && Number.isFinite(available) ? Math.max(HELP_MIN_TEXT, available - HELP_TERM_WIDTH) : undefined
  const lines = HELP.flatMap((section, i) => [...(i > 0 ? [text(E, ' ')] : []), text(E, section.title, { bold: true }), ...section.entries.map((entry) => helpRow(E, entry, room, surface))])
  return E.Box({ flexDirection: 'column', children: lines })
}

export function paneEls(E: Els, tabs: unknown, body: unknown): unknown {
  return E.Box({ flexDirection: 'column', children: [tabs, text(E, ' '), body] })
}

// The dialog of /token-watch recommend: the cost before the call, the wait, and the reply.
// A row has a label column of fixed width and a value that wraps in the room that is left, as the rows of the help tab
const RECOMMEND_LABEL_WIDTH = 15
const RECOMMEND_MIN_TEXT = 20
const RECOMMEND_DATA_NOTE = 'The prompt holds the data of the Session, Week and Why tabs: token counts, costs, plan limits, and the names of repos, memory files, MCP servers and agents. It holds no transcript text, no file content and no prompt text.'
const RECOMMEND_PLAN_NOTE = 'On a subscription the call counts against the plan allowance.'

export type RecommendActions = { onAsk: () => unknown; onCancel: () => unknown }

function recommendRow(E: Els, label: string, value: unknown[], room: number | undefined): unknown {
  return E.Box({
    flexDirection: 'row',
    children: [
      E.Box({ width: RECOMMEND_LABEL_WIDTH, flexShrink: 0, children: [text(E, label, { dimColor: true })] }),
      E.Box({ flexShrink: 1, ...(room === undefined ? {} : { width: room }), children: [E.Text({ wrap: 'wrap', children: value })] }),
    ],
  })
}

// The cost of the call: `$0.04 at API prices of sonnet-5-5`, with ≈ for an estimate. Null for a model without a price
function recommendCostEls(E: Els, cost: number | null, priceModel: string, isEstimate: boolean): unknown[] {
  const source = priceSourceOf(priceModel)
  if (cost === null || source === undefined) return [text(E, 'unknown: the table of the mod has no price for this model')]
  return [text(E, (isEstimate ? '≈ ' : '') + formatMoney(cost), { bold: true }), text(E, ' at API prices of ' + source + ', with the full output cap')]
}

// What the call used, under the reply: model, tokens, cost and where the tabs count it
function recommendUsageEls(E: Els, r: Recommend): unknown[] {
  if (r.counts === null) return []
  const c = r.counts
  const isEstimate = priceInfo(r.priceModel)?.source === 'fallback'
  const cost = priceInfo(r.priceModel) === undefined ? 'no price' : (isEstimate ? '≈ ' : '') + formatMoney(c.cost)
  const line = r.model + ' · input ' + formatTokens(c.input + c.cacheRead + c.cacheWrite) + ' · output ' + formatTokens(c.output) + ' · ' + cost + ' at API prices · counted in the Session tab under the scope ' + RECOMMEND_SCOPE
  return [text(E, ' '), text(E, line, { dimColor: true, wrap: 'wrap' })]
}

export function recommendEls(E: Els, r: Recommend | null, actions: RecommendActions, available?: number): unknown {
  if (r === null) return text(E, 'Run /token-watch recommend to ask for recommendations.', { dimColor: true })
  const room = typeof available === 'number' && Number.isFinite(available) ? Math.max(RECOMMEND_MIN_TEXT, available - RECOMMEND_LABEL_WIDTH) : undefined
  const cancel = E.Button({ key: 'recommend-cancel', label: 'Cancel', hotkey: 'c', onPress: actions.onCancel })
  const column = (children: unknown[]) => E.Box({ flexDirection: 'column', children })
  if (r.phase === 'confirm') {
    return column([
      text(E, 'Ask ' + r.model + ' for recommendations on this usage?', { bold: true }),
      text(E, ' '),
      recommendRow(E, 'model', [text(E, r.model)], room),
      recommendRow(E, 'input', [text(E, '≈ ' + formatTokens(r.inputTokens) + ' tokens, estimated from the length of the prompt')], room),
      recommendRow(E, 'output', [text(E, 'up to ' + formatTokens(r.outputCap) + ' tokens')], room),
      recommendRow(E, 'highest cost', recommendCostEls(E, r.maxCost, r.priceModel, priceInfo(r.priceModel)?.source === 'fallback'), room),
      recommendRow(E, 'plan', [text(E, RECOMMEND_PLAN_NOTE)], room),
      text(E, ' '),
      text(E, RECOMMEND_DATA_NOTE, { wrap: 'wrap' }),
      text(E, ' '),
      E.Box({ flexDirection: 'row', columnGap: 2, children: [E.Button({ key: 'recommend-ask', label: 'Ask ' + r.model, hotkey: 'a', variant: 'primary', onPress: actions.onAsk }), cancel] }),
      text(E, 'a asks, c or Esc cancels. No call runs before you press Ask.', { dimColor: true }),
    ])
  }
  if (r.phase === 'asking') {
    return column([text(E, 'Asking ' + r.model + '…', { bold: true }), text(E, 'The reply shows here. The call stops after 2 minutes.', { dimColor: true, wrap: 'wrap' }), text(E, ' '), cancel])
  }
  if (r.phase === 'answered') return column([E.Markdown!({ text: r.text }), ...recommendUsageEls(E, r)])
  return column([text(E, 'No recommendations', { bold: true }), text(E, r.text, { wrap: 'wrap' }), ...recommendUsageEls(E, r)])
}
