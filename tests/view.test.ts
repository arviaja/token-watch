import { expect, test } from 'claude-code/testing'
import { UNKNOWN_LIFE, cell, dayTime, fitColumns, historyCells, line, markedCell, type HistoryCell } from '../hooks/format'
import { barSvg, heat, heatText, sparkSvg, stageOf, stripCells, stripSvg, tubeAlt, tubeCells } from '../hooks/temperature'
import { EMPTY, NO_CAUSES, NO_MAIN, addTo, countsOf, mainAfter, type NowRow } from '../hooks/tally'
import type { Breakdown, Recommend, Snapshot } from '../types'
import { CAUSE_COLUMNS, HISTORY_COLUMNS, NOW_COLUMNS, SESSION_COLUMNS, TAB_LABELS, WEEK_COLUMNS, WHY_COLUMNS, bandCells as cellsOfBand, bandData, bandEls, barEls, cellTexts, helpEls, nowCells, nowEls, recommendEls, sessionCells, sessionEls, sparkEls, stripEls, svgBox, tableEls, tabsEls, weekData, weekEls, whyEls, type Els, type SessionData, type WeekData } from '../hooks/view'
import { HELP_SECTIONS } from './help-text'
import { reqs } from './helpers'

type Node = { type: string; props: Record<string, any> }
const E: Els = {
  Box: (props) => ({ type: 'Box', props }),
  Text: (props) => ({ type: 'Text', props }),
  Button: (props) => ({ type: 'Button', props }),
  Svg: (props) => ({ type: 'Svg', props }),
  Markdown: (props) => ({ type: 'Markdown', props }),
}
const NO_SVG: Els = { ...E, Svg: undefined }
const SURFACES = ['terminal', 'desktop']
// The round bulb that stood before each tube. The code point is written as an escape, so that no file holds the character
const BULB = '\u25cf'

function flat(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flat).join('')
  const n = node as Node
  if (n.type === 'Box' && n.props.flexDirection === 'column') return (n.props.children ?? []).map(flat).join('\n')
  return (n.props.children ?? []).map(flat).join('')
}

function all(node: unknown, type: string): Node[] {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap((c) => all(c, type))
  const n = node as Node
  return [...(n.type === type ? [n] : []), ...all(n.props.children ?? [], type)]
}

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
const MIN = 60_000
const FABLE = { model: 'claude-fable-5-1', input_tokens: 2, output_tokens: 1000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 10_000 }
const LIMITS = [
  { kind: 'seven_day', percentUsed: 41 },
  { kind: 'five_hour', percentUsed: 12 },
]

function oneRequest() {
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0.2, '1h', '1h')
  const totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3.11))
  return { main, totals }
}

function row(over: Partial<NowRow>): NowRow {
  return { key: 'run:a:1', isCurrent: false, repo: 'webshop', model: 'claude-fable-5-1', contextTokens: 412_000, lastMainRequestAt: T0, mainTtl: '1h', isWorking: false, last60: 6.1, today: 48.2, ...over }
}

test('the band line has the tube with 10 cells, the label, the limits and the models, and no ctx part', async () => {
  const { main, totals } = oneRequest()
  const data = bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)
  expect(data).not.toBeNull()
  const cells = tubeCells(1 - 13 / 60, 10).map((c) => c.char).join('')
  expect(Array.from(cells)).toHaveLength(10)
  expect(flat(bandEls(E, data!))).toBe('▕' + cells + '▏ HOT 47m left · 411k cached · $8.22 to re-warm | week 41% · 5h 12% | fable-5-1 r400k w10.0k o1.0k')
  expect(flat(bandEls(E, data!))).not.toContain('ctx')
})

test('the band keeps the ctx part when there is a context size but no tube', async () => {
  const main = { ...NO_MAIN, contextTokens: 84_400 }
  expect(flat(bandEls(E, bandData(main, {}, LIMITS, T0, T0)!))).toBe('week 41% · 5h 12% | ctx 84.4k')
})

const OPUS = { model: 'claude-opus-5-5', input_tokens: 3, output_tokens: 101_000, cache_read_input_tokens: 25_500_000, cache_creation_input_tokens: 833_000 }
const SONNET = { model: 'claude-sonnet-5-5', input_tokens: 5, output_tokens: 55_300, cache_read_input_tokens: 8_100_000, cache_creation_input_tokens: 312_000 }
const LIMITS_49 = [
  { kind: 'seven_day', percentUsed: 49 },
  { kind: 'five_hour', percentUsed: 8 },
]
const OPUS_TEXT = 'opus-5-5 r25.5M w833k o101k'
const LIMITS_TEXT = 'week 49% · 5h 8%'
const AGE_TEXT = '(2h ago)'

// A conversation with one to three models: opus has the highest cost, then sonnet, then fable. The turn is live, and the context holds 296k
function bandCase(modelCount: number, isOld: boolean = false) {
  let totals = addTo({}, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  if (modelCount > 1) totals = addTo(totals, 'claude-sonnet-5-5', 'main', countsOf(SONNET, 0.5))
  if (modelCount > 2) totals = addTo(totals, 'claude-fable-5-1', 'main', countsOf(FABLE, 0.1))
  const main = { ...mainAfter(NO_MAIN, 'claude-opus-5-5', T0, 296_000, 'start', 0.2, '1h', '1h'), isWorking: true }
  return bandData(main, totals, LIMITS_49, isOld ? T0 - 120 * MIN : T0, T0)!
}

// The text after the tube. The terminal tube is the frame and 10 cells in the text; the desktop tube is an Svg
function afterTube(tree: unknown, surface: string): string {
  return flat(tree).slice(surface === 'terminal' ? 12 : 0).trim()
}

// The cells of the band with a tube. On the terminal the text holds the frame, the 10 tube cells and one cell for each character.
// On the desktop the tube is the Svg, and the text has the widths of the proportional font
function bandCells(tree: unknown, surface: string): number {
  return surface === 'desktop' ? cellsOfBand(flat(tree), true, true) : Array.from(flat(tree)).length
}

test('the band shows only the model with the highest cost, and a dimmed count of the others', async () => {
  const sonnet = { model: 'claude-sonnet-5-5', input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 30_000 }
  const opus = { model: 'claude-opus-5-5', input_tokens: 3, output_tokens: 1100, cache_read_input_tokens: 289_000, cache_creation_input_tokens: 43_100 }
  let totals = addTo({}, 'claude-sonnet-5-5', 'main', countsOf(sonnet, 0.5))
  totals = addTo(totals, 'claude-fable-5-1', 'main', countsOf(FABLE, 0.1))
  totals = addTo(totals, 'claude-opus-5-5', 'main', countsOf(opus, 2.5))
  const main = mainAfter(NO_MAIN, 'claude-opus-5-5', T0, 332_000, 'start', 0.2, '1h', '1h')
  const tree = bandEls(E, bandData(main, totals, [], null, T0 + 13 * MIN)!)
  expect(flat(tree)).toContain('| opus-5-5 r289k w43.1k o1.1k +2 models')
  expect(flat(tree)).not.toContain('sonnet')
  expect(flat(tree)).not.toContain('fable')
  const suffix = all(tree, 'Text').filter((t) => flat(t) === ' +2 models')
  expect(suffix).toHaveLength(1)
  expect(suffix[0].props.dimColor).toBe(true)
  const only = { ...totals }
  delete only['claude-fable-5-1']
  const one = flat(bandEls(E, bandData(main, only, [], null, T0)!))
  expect(one).toMatch(/opus-5-5 r289k w43.1k o1.1k \+1 model$/)
  delete only['claude-sonnet-5-5']
  expect(flat(bandEls(E, bandData(main, only, [], null, T0)!))).toMatch(/opus-5-5 r289k w43.1k o1.1k$/)
})

test('the band names the model with the highest cost, not the model of the last request', async () => {
  let totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3.1))
  totals = addTo(totals, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  const data = bandData(NO_MAIN, totals, LIMITS_49, T0, T0)!
  expect(data.models).toBe('fable-5-1 r400k w10.0k o1.0k')
  expect(data.more).toBe('+1 model')
})

test('the band joins the limits with a dot, and a count of the other models reads +1 model and +2 models', async () => {
  for (const surface of SURFACES) {
    const one = afterTube(bandEls(E, bandCase(1), surface), surface)
    const two = afterTube(bandEls(E, bandCase(2), surface), surface)
    const three = afterTube(bandEls(E, bandCase(3), surface), surface)
    expect(one, surface).toBe('LIVE in turn · 296k cached | ' + LIMITS_TEXT + ' | ' + OPUS_TEXT)
    expect(two, surface).toBe(one + ' +1 model')
    expect(three, surface).toBe(one + ' +2 models')
    expect(afterTube(bandEls(E, bandCase(2, true), surface), surface)).toContain(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ' + OPUS_TEXT + ' +1 model')
  }
  expect(bandCase(1).more).toBe('')
  expect(bandCase(1, true).limitsAge).toBe(AGE_TEXT)
  expect(bandCase(1).limitsAge).toBe('')
  // The age belongs to the limits: no limits, no age
  const withModel = addTo({}, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  expect(bandData(NO_MAIN, withModel, [], T0 - 120 * MIN, T0)!.limitsAge).toBe('')
})

// The parts of the band in the order that they stay: the limits, the age, the model and the count of the others
const BAND_WIDTHS = [60, 80, 100, 120, 160, undefined]
const shownParts = (text: string) => ({
  limits: text.includes(LIMITS_TEXT),
  age: text.includes(AGE_TEXT),
  models: text.includes(OPUS_TEXT),
  more: /\+\d models?$/.test(text),
})

test('the band is never wider than the available cells less a margin of 4, and its parts leave from the right, on both surfaces', async () => {
  for (const surface of SURFACES) {
    for (const modelCount of [1, 2, 3]) {
      for (const isOld of [false, true]) {
        const data = bandCase(modelCount, isOld)
        const where = surface + ', ' + modelCount + ' models, ' + (isOld ? 'old' : 'fresh') + ' limits'
        let last = { limits: false, age: false, models: false, more: false }
        for (const width of BAND_WIDTHS.filter((w) => w !== undefined).sort((a, b) => a! - b!)) {
          const tree = bandEls(E, data, surface, width)
          const text = afterTube(tree, surface)
          const shown = shownParts(text)
          // The tube, the stage word and the label alone take 39 cells: they fit in each width of the list
          expect(bandCells(tree, surface), where + ' at ' + width).toBeLessThanOrEqual(width! - 4)
          expect(text.startsWith('LIVE in turn · 296k cached'), where + ' at ' + width).toBe(true)
          // The order: the count of the others goes first, then the model, then the age, then the limits
          if (shown.more) expect(shown.models, where + ' at ' + width).toBe(true)
          if (shown.models) expect(shown.limits, where + ' at ' + width).toBe(true)
          if (shown.models && isOld) expect(shown.age, where + ' at ' + width).toBe(true)
          if (shown.age) expect(shown.limits, where + ' at ' + width).toBe(true)
          // A wider band keeps every part of a narrower band
          for (const key of ['limits', 'age', 'models', 'more'] as const) if (last[key]) expect(shown[key], where + ' at ' + width + ' has lost ' + key).toBe(true)
          last = shown
        }
        // Without a number, nothing leaves
        const free = afterTube(bandEls(E, data, surface), surface)
        expect(shownParts(free), where).toEqual({ limits: true, age: isOld, models: true, more: modelCount > 1 })
        expect(afterTube(bandEls(E, data, surface, 160), surface), where).toBe(free)
        expect(afterTube(bandEls(E, data, surface, Number.NaN), surface), where).toBe(free)
      }
    }
  }
})

test('the band leaves out the parts at the widths 60, 80, 100, 120 and 160, with the cells of each surface', async () => {
  const base = 'LIVE in turn · 296k cached'
  const limits = base + ' | ' + LIMITS_TEXT
  const aged = limits + ' ' + AGE_TEXT
  const withModel = (text: string) => text + ' | ' + OPUS_TEXT
  // [surface, model count, old limits, width, the text after the tube]. The desktop text is proportional and narrower than one cell a character,
  // so at 60, 80 and 100 the desktop keeps parts that the terminal drops
  const cases: [string, number, boolean, number, string][] = [
    ['terminal', 2, false, 60, base],
    ['terminal', 2, false, 80, limits],
    ['terminal', 2, false, 100, withModel(limits)],
    ['terminal', 2, false, 120, withModel(limits) + ' +1 model'],
    ['terminal', 2, false, 160, withModel(limits) + ' +1 model'],
    ['desktop', 2, false, 60, limits],
    ['desktop', 2, false, 80, withModel(limits)],
    ['desktop', 2, false, 100, withModel(limits) + ' +1 model'],
    ['desktop', 2, false, 120, withModel(limits) + ' +1 model'],
    ['terminal', 3, false, 100, withModel(limits)],
    ['desktop', 3, false, 100, withModel(limits) + ' +2 models'],
    ['terminal', 3, false, 120, withModel(limits) + ' +2 models'],
    ['terminal', 2, true, 60, base],
    ['terminal', 2, true, 80, aged],
    ['terminal', 2, true, 100, aged],
    ['terminal', 2, true, 120, withModel(aged) + ' +1 model'],
    ['desktop', 2, true, 60, aged],
    ['desktop', 2, true, 80, aged],
    ['desktop', 2, true, 100, withModel(aged) + ' +1 model'],
    ['desktop', 3, true, 100, withModel(aged) + ' +2 models'],
    ['desktop', 2, true, 120, withModel(aged) + ' +1 model'],
  ]
  for (const [surface, modelCount, isOld, width, expected] of cases) {
    expect(afterTube(bandEls(E, bandCase(modelCount, isOld), surface, width), surface), surface + ', ' + modelCount + ' models, ' + (isOld ? 'old' : 'fresh') + ' limits, ' + width + ' columns').toBe(expected)
  }
})

test('bandCells counts one cell for each character and a tube of 12 on the terminal, and the proportional widths and a tube of 12 on the desktop', async () => {
  expect(cellsOfBand('week 49%', true, false)).toBe(20)
  expect(cellsOfBand('week 49%', false, false)).toBe(8)
  // In hundredths of a cell, so that float rounding does not count. The desktop counts the text 4% wider than desktopCells: 8.03 times 1.04
  expect(Math.round(cellsOfBand('week 49%', true, true) * 100)).toBe(2035)
  expect(Math.round(cellsOfBand('week 49%', false, true) * 100)).toBe(835)
  expect(cellsOfBand('', true, true)).toBe(12)
})

test('the band keeps the tube, the stage word and the label when they alone are wider than the budget', async () => {
  const { main, totals } = oneRequest()
  const data = bandData(main, totals, LIMITS_49, T0 - 120 * MIN, T0 + 44 * MIN)!
  expect(data.stage).toBe('COOLING')
  // The tube, the stage word and the label take 62 cells on the terminal and 52.39 on the desktop
  const widths: Record<string, number[]> = { terminal: [20, 50, 60], desktop: [20, 40, 50] }
  for (const surface of SURFACES) {
    for (const width of widths[surface]) {
      const tree = bandEls(E, data, surface, width)
      const text = afterTube(tree, surface)
      expect(text, surface + ' at ' + width).toBe('COOLING 16m left · 411k cached · $8.22 to re-warm')
      expect(bandCells(tree, surface)).toBeGreaterThan(width - 4)
      // The terminal cuts the label at the end, as before
      const line = all(tree, 'Text').find((t) => t.props.wrap === 'truncate-end')
      expect(line).toBeDefined()
    }
    // With room the other parts come back
    expect(afterTube(bandEls(E, data, surface, 160), surface)).toContain(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ' + 'fable-5-1 r400k w10.0k o1.0k')
  }
})

test('the band without a tube leaves out the models, the context size, the age and then the limits, and keeps the last text', async () => {
  const main = { ...NO_MAIN, contextTokens: 84_400 }
  let totals = addTo({}, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  totals = addTo(totals, 'claude-sonnet-5-5', 'main', countsOf(SONNET, 0.5))
  const data = bandData(main, totals, LIMITS_49, T0 - 120 * MIN, T0)!
  expect(data.fraction).toBeNull()
  const full = LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k | ' + OPUS_TEXT + ' +1 model'
  // On the desktop the same line is 61.79 cells, without the count 54.42, without the models 30.02, without the context size 21.41 and without the age 14.44
  const desktopAt = (width?: number) => flat(bandEls(E, data, 'desktop', width))
  expect(desktopAt(66)).toBe(full)
  expect(desktopAt(65)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k | ' + OPUS_TEXT)
  expect(desktopAt(59)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k | ' + OPUS_TEXT)
  expect(desktopAt(58)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k')
  expect(desktopAt(35)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k')
  expect(desktopAt(34)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT)
  expect(desktopAt(26)).toBe(LIMITS_TEXT + ' ' + AGE_TEXT)
  expect(desktopAt(25)).toBe(LIMITS_TEXT)
  expect(desktopAt(6)).toBe(LIMITS_TEXT)
  for (const surface of ['terminal']) {
    const at = (width?: number) => flat(bandEls(E, data, surface, width))
    // The full line is 76 cells, the line without the count 67, without the models 37, without the context size 25 and without the age 16
    expect(at(), surface).toBe(full)
    expect(at(80), surface).toBe(full)
    expect(at(79), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k | ' + OPUS_TEXT)
    expect(at(71), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k | ' + OPUS_TEXT)
    expect(at(70), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k')
    expect(at(41), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT + ' | ctx 84.4k')
    expect(at(40), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT)
    expect(at(29), surface).toBe(LIMITS_TEXT + ' ' + AGE_TEXT)
    expect(at(28), surface).toBe(LIMITS_TEXT)
    expect(at(20), surface).toBe(LIMITS_TEXT)
    // Nothing is left to leave out: the line is never empty
    expect(at(19), surface).toBe(LIMITS_TEXT)
    expect(at(6), surface).toBe(LIMITS_TEXT)
  }
  // Without limits, the last text is the model
  const onlyModels = bandData(NO_MAIN, totals, [], null, T0)!
  expect(flat(bandEls(E, onlyModels, 'terminal', 10))).toBe(OPUS_TEXT)
})

// Limits with a reset time, read at T0. The week is at 49% after 72 of its 168 hours, the 5-hour window at 62% after 2 of its 5 hours.
// Both reach 100% before their reset: the 5-hour window 73.5 minutes after the reading
const HOUR_MS = 60 * MIN
const WEEK_LIMIT = { kind: 'seven_day', percentUsed: 49, resetsAt: new Date(T0 + 96 * HOUR_MS).toISOString() }
const FIVE_LIMIT = { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(T0 + 3 * HOUR_MS).toISOString() }
const PROJECTED_LIMITS = [WEEK_LIMIT, FIVE_LIMIT]
const WEEK_FULL = ' → 100% ' + dayTime(T0 - 72 * HOUR_MS + (72 * HOUR_MS * 100) / 49)
const FIVE_FULL = ' → 100% ' + dayTime(T0 - 2 * HOUR_MS + (2 * HOUR_MS * 100) / 62)
const LIVE_TEXT = 'LIVE in turn · 296k cached'

// The live conversation of bandCase with two models, and the limits read at limitsAt
function projectedCase(limitsAt: number, now: number) {
  let totals = addTo({}, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  totals = addTo(totals, 'claude-sonnet-5-5', 'main', countsOf(SONNET, 0.5))
  const main = { ...mainAfter(NO_MAIN, 'claude-opus-5-5', T0, 296_000, 'start', 0.2, '1h', '1h'), isWorking: true }
  return bandData(main, totals, PROJECTED_LIMITS, limitsAt, now)!
}

test('the band shows the day and the time when each limit reaches 100%, after its percent, on both surfaces', async () => {
  const limits = 'week 49%' + WEEK_FULL + ' · 5h 62%' + FIVE_FULL
  expect(WEEK_FULL).toMatch(/^ → 100% (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/)
  expect(FIVE_FULL).toMatch(/^ → 100% (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/)
  for (const surface of SURFACES) {
    const tree = bandEls(E, projectedCase(T0, T0), surface)
    expect(afterTube(tree, surface), surface).toBe(LIVE_TEXT + ' | ' + limits + ' | ' + OPUS_TEXT + ' +1 model')
    // The limits and their projections are one plain Text
    const text = all(tree, 'Text').find((t) => flat(t) === limits)
    expect(text, surface).toBeDefined()
    expect(Object.keys(text!.props), surface).toEqual(['children'])
  }
})

test('the band shows no projection for a limit that does not reach 100% before its reset, or that has no reset time', async () => {
  const main = { ...mainAfter(NO_MAIN, 'claude-opus-5-5', T0, 296_000, 'start', 0.2, '1h', '1h'), isWorking: true }
  const totals = addTo({}, 'claude-opus-5-5', 'main', countsOf(OPUS, 2.5))
  const slow = [
    { ...WEEK_LIMIT, percentUsed: 30 },
    { ...FIVE_LIMIT, percentUsed: 31 },
  ]
  expect(afterTube(bandEls(E, bandData(main, totals, slow, T0, T0)!), 'terminal')).toBe(LIVE_TEXT + ' | week 30% · 5h 31% | ' + OPUS_TEXT)
  // Only the weekly limit reaches 100%
  const onlyWeek = [WEEK_LIMIT, { ...FIVE_LIMIT, percentUsed: 31 }]
  expect(afterTube(bandEls(E, bandData(main, totals, onlyWeek, T0, T0)!), 'terminal')).toBe(LIVE_TEXT + ' | week 49%' + WEEK_FULL + ' · 5h 31% | ' + OPUS_TEXT)
  // No reset time, and the spend limit has no window
  const noReset = [{ kind: 'seven_day', percentUsed: 49 }, { kind: 'five_hour', percentUsed: 62 }, { kind: 'spend_limit', percentUsed: 90, resetsAt: FIVE_LIMIT.resetsAt }]
  expect(afterTube(bandEls(E, bandData(main, totals, noReset, T0, T0)!), 'terminal')).toBe(LIVE_TEXT + ' | week 49% · 5h 62% · spend 90% | ' + OPUS_TEXT)
})

test('the band leaves out the models, then the 5-hour projection, then the weekly projection, then the limits, on both surfaces', async () => {
  const both = 'week 49%' + WEEK_FULL + ' · 5h 62%' + FIVE_FULL
  const weekOnly = 'week 49%' + WEEK_FULL + ' · 5h 62%'
  const plain = 'week 49% · 5h 62%'
  const withModel = (limits: string) => LIVE_TEXT + ' | ' + limits + ' | ' + OPUS_TEXT
  // The line with both projections is 93 cells on the terminal, the model adds 30 and the count 9.
  // On the desktop the line is 76.73 cells, with the model 101.13 and with the count 108.49, so the same parts stay at smaller widths
  const cases: Record<string, [number, string][]> = {
    terminal: [
      [140, withModel(both) + ' +1 model'],
      [130, withModel(both)],
      [110, LIVE_TEXT + ' | ' + both],
      [90, LIVE_TEXT + ' | ' + weekOnly],
      [70, LIVE_TEXT + ' | ' + plain],
      [60, LIVE_TEXT],
    ],
    desktop: [
      [140, withModel(both) + ' +1 model'],
      [110, withModel(both)],
      [90, LIVE_TEXT + ' | ' + both],
      [70, LIVE_TEXT + ' | ' + weekOnly],
      [60, LIVE_TEXT + ' | ' + plain],
      [50, LIVE_TEXT],
    ],
  }
  for (const surface of SURFACES) {
    for (const [width, expected] of cases[surface]) {
      const tree = bandEls(E, projectedCase(T0, T0), surface, width)
      expect(afterTube(tree, surface), surface + ' at ' + width).toBe(expected)
      expect(bandCells(tree, surface), surface + ' at ' + width).toBeLessThanOrEqual(width - 4)
    }
    // At every width the band keeps one line, and a wider band keeps every part of a narrower one
    let last = ''
    for (let width = 40; width <= 150; width++) {
      const tree = bandEls(E, projectedCase(T0, T0), surface, width)
      const text = afterTube(tree, surface)
      // A band with more than the tube and its label fits its width
      if (text !== LIVE_TEXT) expect(bandCells(tree, surface), surface + ' at ' + width).toBeLessThanOrEqual(width - 4)
      if (text.includes(FIVE_FULL)) expect(text, surface + ' at ' + width).toContain(WEEK_FULL)
      if (text.includes(OPUS_TEXT)) expect(text, surface + ' at ' + width).toContain(both)
      expect(text.length, surface + ' at ' + width).toBeGreaterThanOrEqual(last.length)
      last = text
    }
  }
})

test('the band takes the pace up to the time of the reading, shows its age, and hides a projection whose time has passed', async () => {
  const both = 'week 49%' + WEEK_FULL + ' · 5h 62%' + FIVE_FULL
  for (const surface of SURFACES) {
    // 70 minutes after the reading: the age shows, and the times are those of the reading. The 5-hour limit reaches 100% after 73.5 minutes
    expect(afterTube(bandEls(E, projectedCase(T0, T0 + 70 * MIN), surface), surface)).toBe(LIVE_TEXT + ' | ' + both + ' (1h ago) | ' + OPUS_TEXT + ' +1 model')
    // 80 minutes after the reading the 5-hour time has passed: only the weekly projection stays, with the time of the reading
    expect(afterTube(bandEls(E, projectedCase(T0, T0 + 80 * MIN), surface), surface)).toBe(LIVE_TEXT + ' | week 49%' + WEEK_FULL + ' · 5h 62% (1h ago) | ' + OPUS_TEXT + ' +1 model')
    // The age leaves before the projections: the line with the age is 102 cells on the terminal and 83.35 on the desktop
    expect(afterTube(bandEls(E, projectedCase(T0, T0 + 70 * MIN), surface, surface === 'terminal' ? 100 : 84), surface)).toBe(LIVE_TEXT + ' | ' + both)
  }
  // With the time of a reading both limits have a projection, without it neither has one
  expect(projectedCase(T0, T0).limits.map((l) => l.projection)).toEqual([WEEK_FULL, FIVE_FULL])
  expect(bandData(NO_MAIN, {}, PROJECTED_LIMITS, null, T0)!.limits.map((l) => l.projection)).toEqual(['', ''])
})

test('the band colours the stage word with the text colour of heat and the tube cells with the heat colour', async () => {
  const { main, totals } = oneRequest()
  const tree = bandEls(E, bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!)
  const texts = all(tree, 'Text')
  const stage = texts.find((t) => flat(t) === 'HOT')
  expect(stage?.props.color).toBe(heatText(1 - 13 / 60))
  expect(stage?.props.bold).toBe(true)
  expect(texts.filter((t) => flat(t) === '░').every((t) => t.props.dimColor === true)).toBe(true)
  expect((tree as Node).props.wrap).toBe('truncate-end')
})

test('the band shows only the limits before the first request, and nothing without limits', async () => {
  expect(flat(bandEls(E, bandData(NO_MAIN, {}, LIMITS, T0, T0)!))).toBe('week 41% · 5h 12%')
  expect(bandData(NO_MAIN, {}, [], null, T0)).toBeNull()
})

test('the band shows a cold cache and a live turn', async () => {
  const { main, totals } = oneRequest()
  expect(flat(bandEls(E, bandData(main, totals, [], null, T0 + 75 * MIN)!))).toContain('COLD 15m · next message re-writes 411k ≈ $8.22')
  expect(flat(bandEls(E, bandData({ ...main, isWorking: true }, totals, [], null, T0 + 75 * MIN)!))).toContain('LIVE in turn · 411k cached')
})

test('the band shows the tokens of an unpriced model', async () => {
  const totals = addTo({}, 'unknown-model', 'main', countsOf({ ...FABLE, model: 'unknown-model' }, 0))
  const main = mainAfter(NO_MAIN, 'unknown-model', T0, 411_002, 'start', 0, '1h', '1h')
  expect(flat(bandEls(E, bandData(main, totals, [], null, T0 + 13 * MIN)!))).toContain('47m left · 411k cached | unknown-model r400k w10.0k o1.0k')
})

test('every row of the Now table has the same width and the same column starts', async () => {
  const rows = [
    row({ isCurrent: true, isWorking: true }),
    row({ key: 'run:b:1', repo: 'billing-service', model: 'claude-opus-5-5', lastMainRequestAt: T0 - 31 * MIN }),
    row({ key: 'run:c:1', repo: 'data-pipeline-config', model: 'claude-opus-5-5', lastMainRequestAt: T0 - 75 * MIN }),
    row({ key: 'run:d:1', lastMainRequestAt: null }),
    row({ key: 'run:e:1', repo: 'data-pipeline-conf', lastMainRequestAt: T0 - 5 * MIN }),
  ]
  const lines = [line(['cache', 'repo', 'model', 'ctx', '60 min', 'today'], NOW_COLUMNS), ...rows.map((r) => line(nowCells(r, T0), NOW_COLUMNS))]
  expect(new Set(lines.map((l) => Array.from(l).length))).toEqual(new Set([80]))
  // The current row has no marker: it starts with its tube like the other rows
  expect(lines[1]).toBe('████████ LIVE         webshop              fable-5-1    412k     $6.10    $48.20')
  expect(lines[2]).toBe('███▊░░░░ WARM     29m billing-service      opus-5-5     412k     $6.10    $48.20')
  expect(lines[3]).toBe('░░░░░░░░ COLD         data-pipeline-config opus-5-5     412k     $6.10    $48.20')
  // The 2 cells of the removed marker column belong to the repo column: a name of 20 characters stays whole
  expect(lines[5].slice(22, 22 + 21)).toBe('data-pipeline-conf   ')
  for (const l of lines) expect(l).not.toContain('>')
})

test('the Now table draws one Box per column with the column width', async () => {
  const tree = nowEls(E, [row({ isCurrent: true }), row({ key: 'run:b:1', lastMainRequestAt: T0 - 31 * MIN })], T0)
  const rowsBoxes = ((tree as Node).props.children as Node[]).filter((n) => n.props.flexDirection === 'row')
  for (const r of rowsBoxes) {
    const widths = (r.props.children as Node[]).map((c) => c.props.width)
    expect(widths).toEqual(NOW_COLUMNS.map((c) => c.width))
    expect((r.props.children as Node[]).every((c) => c.props.flexShrink === 0)).toBe(true)
    expect(Array.from(flat(r)).length).toBe(80)
  }
  const right = (rowsBoxes[1].props.children as Node[])[3]
  expect(right.props.justifyContent).toBe('flex-end')
})

const SESSION: SessionData = {
  rows: [
    { model: 'claude-fable-5-1', scope: 'main', counts: { ...EMPTY, requests: 84, cacheRead: 31_000_000, cacheWrite: 1_200_000, output: 120_000, input: 1000, cost: 24.1 } },
    { model: 'claude-opus-5-5', scope: 'general-purpose', counts: { ...EMPTY, requests: 52, cacheRead: 12_000_000, cacheWrite: 800_000, output: 14_000, input: 400, cost: 9.2 } },
  ],
  total: { ...EMPTY, requests: 136, cacheRead: 43_000_000, cacheWrite: 2_000_000, output: 134_000, input: 1400, cost: 33.3 },
  causes: { start: { tokens: 300_000, cost: 1 }, growth: { tokens: 600_000, cost: 2 }, resume: { tokens: 300_000, cost: 1 } },
  requests: reqs([T0 - 30 * MIN]),
  resumes: [{ at: T0 - 30 * MIN, cost: 7.6 }],
  now: T0,
  usd: 39.2,
}

const SESSION_NOTE = 'estimate: the requests this mod saw, at API prices. /cost: the figure of Claude Code. It also counts requests that the mod does not see, for example compaction.'

const BAR_CHARS = ['█', '░', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The tables of a tab: a column Box whose children are all row Boxes
function tablesOf(tree: unknown): Node[] {
  return all(tree, 'Box').filter((b) => b.props.flexDirection === 'column' && (b.props.children as Node[]).every((c) => c.props.flexDirection === 'row'))
}

const tableRows = (table: Node) => table.props.children as Node[]
const widthsOf = (row: Node) => (row.props.children as Node[]).map((c) => c.props.width)
const total = (columns: { width: number }[]) => columns.reduce((sum, c) => sum + c.width, 0)

test('the Session tab has the main table, a note, the cause table and the history grid with a blank line between them', async () => {
  const tree = sessionEls(E, SESSION)
  const parts = (tree as Node).props.children as Node[]
  expect(parts.map((p) => p.type)).toEqual(['Box', 'Text', 'Text', 'Box', 'Text', 'Box'])
  expect([flat(parts[1]), flat(parts[2]), flat(parts[4])]).toEqual([SESSION_NOTE, ' ', ' '])
  expect(tablesOf(tree)).toHaveLength(3)
  expect([0, 1, 2].map((i) => tablesOf(tree)[i])).toEqual([parts[0], parts[3], parts[5]])
  const withoutNote = (sessionEls(E, { ...SESSION, usd: null }) as Node).props.children as Node[]
  expect(withoutNote.map((p) => p.type)).toEqual(['Box', 'Text', 'Box', 'Text', 'Box'])
  expect([flat(withoutNote[1]), flat(withoutNote[3])]).toEqual([' ', ' '])
  const text = flat(tree)
  expect(text).toContain('fable-5-1  main               84   1.0k     1.2M  31.0M    120k    $24.10    72%')
  expect(text).toContain('opus-5-5   general-purpose    52    400     800k  12.0M   14.0k     $9.20    28%')
  expect(text).toContain('total      estimate          136   1.4k     2.0M  43.0M    134k    $33.30')
  expect(text).toContain('reported   by /cost                                                $39.20')
  expect(text).toContain('cache, last 4 h')
  expect(text).toContain('resumes')
  expect(text).not.toContain('one cell = 5 min')
  expect(text).not.toContain('Claude Code session cost')
  expect(flat(sessionEls(E, { ...SESSION, rows: [] }))).toBe('No model request in this session yet.')
})

test('the Session main table ends with a bold total with a dimmed estimate cell and a dimmed reported row with its cost in the cost column', async () => {
  for (const surface of SURFACES) {
    const main = tablesOf(sessionEls(E, SESSION, undefined, surface))[0]
    const rows = tableRows(main)
    expect(rows).toHaveLength(5)
    expect(flat(rows[3]).startsWith('total      estimate')).toBe(true)
    // The estimate cell is dimmed and the rest of the total row is bold
    expect(styleOf(main, 3, 0)).toEqual({ bold: true })
    expect(styleOf(main, 3, 1)).toEqual({ dimColor: true })
    expect([2, 7].map((ci) => styleOf(main, 3, ci))).toEqual([{ bold: true }, { bold: true }])
    expect(styleOf(main, 2, 0)).toEqual({})
    expect(flat((rows[3].props.children as Node[])[1])).toBe('estimate'.padEnd(16))
    expect(flat(rows[4]).startsWith('reported   by /cost')).toBe(true)
    expect([0, 1, 7].map((ci) => styleOf(main, 4, ci))).toEqual([{ dimColor: true }, { dimColor: true }, { dimColor: true }])
    const costBox = (rows[4].props.children as Node[])[7]
    expect(costBox.props.width).toBe(10)
    expect(flat(costBox)).toBe('    $39.20')
    // The cost ends under the end of the header cost
    expect(flat(rows[4]).indexOf('$39.20') + 6).toBe(flat(rows[0]).indexOf('cost') + 4)
    for (const r of rows) expect(Array.from(flat(r))).toHaveLength(total(SESSION_COLUMNS))
    expect(flat(main)).not.toContain('Claude Code')
  }
})

test('the Session main table has no reported row when Claude Code reports no cost, on both surfaces', async () => {
  for (const surface of SURFACES) {
    const without = tablesOf(sessionEls(E, { ...SESSION, usd: null }, undefined, surface))[0]
    expect(tableRows(without)).toHaveLength(4)
    expect(flat(without)).not.toContain('reported')
    expect(flat(without)).not.toContain('/cost')
    // The total row still says estimate
    expect(flat(tableRows(without)[3]).startsWith('total      estimate')).toBe(true)
    expect(styleOf(without, 3, 0)).toEqual({ bold: true })
    expect(styleOf(without, 3, 1)).toEqual({ dimColor: true })
  }
})

test('the Session note is one dimmed Text under the main table, with the reported row, on both surfaces', async () => {
  for (const surface of SURFACES) {
    const tree = sessionEls(E, SESSION, undefined, surface)
    const parts = (tree as Node).props.children as Node[]
    const note = parts[1]
    expect(note.type).toBe('Text')
    expect(flat(note)).toBe(SESSION_NOTE)
    expect(note.props.children).toEqual([SESSION_NOTE])
    expect(note.props.dimColor).toBe(true)
    expect(note.props.wrap).toBe('wrap')
    // The note is not a row of a table, and it is the only Text of the tab that holds it
    expect(tablesOf(tree)).toHaveLength(3)
    expect(all(tree, 'Text').filter((t) => flat(t).startsWith('estimate:'))).toEqual([note])
    // The note comes with the reported row and goes with it
    const without = sessionEls(E, { ...SESSION, usd: null }, undefined, surface)
    expect(all(without, 'Text').filter((t) => flat(t).includes('estimate:'))).toEqual([])
    expect(flat(without)).not.toContain('API prices')
    // Without a model request the tab shows neither the table nor the note
    expect(flat(sessionEls(E, { ...SESSION, rows: [] }, undefined, surface))).toBe('No model request in this session yet.')
  }
})

test('the cause table has a dimmed header and three rows of the same widths on both surfaces', async () => {
  expect(total(CAUSE_COLUMNS)).toBe(59)
  for (const surface of SURFACES) {
    const table = tablesOf(sessionEls(E, SESSION, undefined, surface))[1]
    const rows = tableRows(table)
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(widthsOf(r)).toEqual([14, 21, 8, 10, 6])
      expect((r.props.children as Node[]).every((c) => c.props.flexShrink === 0)).toBe(true)
    }
    expect(flat(rows[0])).toBe('cache writes'.padEnd(14) + ' '.repeat(21) + 'tokens'.padStart(8) + 'cost'.padStart(10) + 'share'.padStart(6))
    expect(styleOf(table, 0, 0)).toEqual({ dimColor: true })
    const bars = rows.slice(1).map((r) => (r.props.children as Node[])[1])
    if (surface === 'desktop') {
      expect(bars.map((b) => (b.props.children as Node[]).map((c) => [c.type, c.props.width]))).toEqual([[['Box', 20]], [['Box', 20]], [['Box', 20]]])
    } else {
      expect(flat(rows[1])).toBe('start'.padEnd(14) + '█'.repeat(5) + '░'.repeat(15) + ' ' + '300k'.padStart(8) + '$1.00'.padStart(10) + '25%'.padStart(6))
      expect(flat(rows[2])).toBe('growth'.padEnd(14) + '█'.repeat(10) + '░'.repeat(10) + ' ' + '600k'.padStart(8) + '$2.00'.padStart(10) + '50%'.padStart(6))
      expect(flat(rows[3])).toBe('resume'.padEnd(14) + '█'.repeat(5) + '░'.repeat(15) + ' ' + '300k'.padStart(8) + '$1.00'.padStart(10) + '25%'.padStart(6))
      for (const r of rows) expect(Array.from(flat(r))).toHaveLength(59)
    }
  }
})

test('the cause bars share the cost of the three causes, and are empty without cost', async () => {
  const cost = (causes: SessionData['causes']) => all(sessionEls(E, { ...SESSION, causes }, undefined, 'desktop'), 'Svg').slice(0, 3).map((s) => s.props.alt)
  expect(cost({ start: { tokens: 1, cost: 1 }, growth: { tokens: 1, cost: 1 }, resume: { tokens: 1, cost: 2 } })).toEqual(['share 25%', 'share 25%', 'share 50%'])
  expect(cost({ start: { tokens: 1, cost: 1 }, growth: { tokens: 1, cost: 0 }, resume: { tokens: 1, cost: 2 } })).toEqual(['share 33%', 'share 0%', 'share 67%'])
  expect(cost(NO_CAUSES)).toEqual(['share 0%', 'share 0%', 'share 0%'])
  expect(flat(sessionEls(E, { ...SESSION, causes: NO_CAUSES })).split('\n').filter((l) => l.startsWith('start'))).toEqual(['start'.padEnd(14) + '░'.repeat(20) + ' ' + '0'.padStart(8) + '$0.00'.padStart(10) + '0%'.padStart(6)])
})

test('on the desktop the Session tab holds four Svg in boxes with a width and no bar character in a Text', async () => {
  const tree = sessionEls(E, SESSION, undefined, 'desktop')
  const svgs = all(tree, 'Svg')
  expect(svgs.map((v) => v.props.alt)).toEqual(['share 25%', 'share 50%', 'share 25%', 'cache history of the last 4 hours'])
  expect(svgs.map((v) => v.props.source)).toEqual([barSvg(0.25, 20), barSvg(0.5, 20), barSvg(0.25, 20), stripSvg(stripCells(SESSION.requests, T0))])
  expect(svgs.every((v) => v.props.width === undefined && v.props.height === undefined)).toBe(true)
  const boxes = all(tree, 'Box').filter((b) => (b.props.children as Node[]).some((c) => c.type === 'Svg'))
  expect(boxes.map((b) => [b.props.width, b.props.flexShrink])).toEqual([[20, 0], [20, 0], [20, 0], [48, 0]])
  for (const t of all(tree, 'Text')) for (const ch of BAR_CHARS) expect(flat(t)).not.toContain(ch)
})

test('on the terminal the Session tab holds no Svg and draws the bars and the strip as text', async () => {
  for (const tree of [sessionEls(E, SESSION), sessionEls(E, SESSION, undefined, 'terminal'), sessionEls(NO_SVG, SESSION, undefined, 'desktop')]) {
    expect(all(tree, 'Svg')).toHaveLength(0)
    expect(flat(tree)).toContain('█████░░░░░░░░░░░░░░░ ')
    const strip = flat(tablesOf(tree)[2]).split('\n')[0]
    // A request 30 minutes ago keeps the cells of the last 35 minutes warm
    expect(strip).toBe('cache, last 4 h ' + ' '.repeat(41) + '█'.repeat(7) + ' ')
  }
})

// The history grid of the Session tab. Its rows are the strip, the resumes (only with a resume in the strip) and the time axis
const historyRows = (resumes: SessionData['resumes'], surface = 'terminal', els: Els = E, available?: number) => tableRows(tablesOf(sessionEls(els, { ...SESSION, resumes }, available, surface))[2])
const columnOf = (r: Node, i: number) => (r.props.children as Node[])[i]
const AXIS_TEXT = '-4 h'.padEnd(12) + '-3 h'.padEnd(12) + '-2 h'.padEnd(12) + '-1 h'.padEnd(9) + 'now' + ' '

// The pieces of text of a desktop row with their cell offsets: the sum of the widths of the Boxes before each piece
function offsets(column: Node): [number, string][] {
  let at = 0
  const found: [number, string][] = []
  for (const piece of kids(column)) {
    if (kids(piece).length > 0) found.push([at, flat(piece)])
    at += piece.props.width
  }
  return found
}

// The text of a row of 49 cells from the pieces [cell, text]
const rowText = (pieces: [number, string][]) => pieces.reduce((line, [at, piece]) => line.padEnd(at) + piece, '').padEnd(49)

// Checks the row of the resumes on both surfaces: the exact text on the terminal, and the Box widths before each piece on the desktop
function expectResumes(resumes: SessionData['resumes'], pieces: [number, string][]) {
  const terminal = historyRows(resumes)
  expect(terminal, 'terminal rows').toHaveLength(3)
  expect(flat(terminal[1])).toBe('resumes'.padEnd(16) + rowText(pieces))
  expect(flat(terminal[2])).toBe(' '.repeat(16) + AXIS_TEXT)
  const desktop = historyRows(resumes, 'desktop')
  expect(desktop, 'desktop rows').toHaveLength(3)
  expect(offsets(columnOf(desktop[1], 1))).toEqual(pieces)
  expect(widthsOf(desktop[1])).toEqual([16, 49])
  // A surface without Svg draws the text cells of the terminal
  expect(historyRows(resumes, 'desktop', NO_SVG).map((r) => flat(r))).toEqual(terminal.map((r) => flat(r)))
}

test('the history grid has a labelled strip, a row of resumes and a time axis on the terminal', async () => {
  const rows = historyRows(SESSION.resumes)
  expect(rows).toHaveLength(3)
  expect(rows.map(widthsOf)).toEqual(Array(3).fill([16, 49]))
  expect(rows.map((r) => flat(r))).toEqual([
    'cache, last 4 h ' + ' '.repeat(41) + '█'.repeat(7) + ' ',
    'resumes         ' + ' '.repeat(41) + '▲ $7.60' + ' ',
    ' '.repeat(16) + AXIS_TEXT,
  ])
  // The three labels are dimmed. The header row and its text `one cell = 5 min` are gone
  const table = tablesOf(sessionEls(E, SESSION))[2]
  expect([0, 1, 2].map((ri) => styleOf(table, ri, 0))).toEqual(Array(3).fill({ dimColor: true }))
  expect(flat(table)).not.toContain('one cell')
  // The mark is in the heat colour of a resume, the cost has no style of its own and the axis is dimmed
  expect(all(columnOf(rows[1], 1), 'Text').map((t) => t.props)).toEqual([{ children: [' '.repeat(41)] }, { color: heatText(1), children: ['▲'] }, { children: [' $7.60'] }, { children: [' '] }])
  expect(all(columnOf(rows[2], 1), 'Text').filter((t) => flat(t).trim() !== '').map((t) => t.props)).toEqual(['-4 h', '-3 h', '-2 h', '-1 h', 'now'].map((c) => ({ dimColor: true, children: [c] })))
  expect(AXIS_TEXT.indexOf('-4 h')).toBe(0)
  expect(['-3 h', '-2 h', '-1 h', 'now'].map((c) => AXIS_TEXT.indexOf(c))).toEqual([12, 24, 36, 45])
})

test('on the desktop the resumes and the time axis sit at their cells in Boxes of fixed width, and no Text places them with spaces', async () => {
  const rows = historyRows(SESSION.resumes, 'desktop')
  expect(rows).toHaveLength(3)
  expect(rows.map(widthsOf)).toEqual(Array(3).fill([16, 49]))
  expect(all(columnOf(rows[0], 1), 'Svg')).toHaveLength(1)
  expect(kids(columnOf(rows[1], 1)).map((b) => b.props.width)).toEqual([41, 8])
  expect(offsets(columnOf(rows[1], 1))).toEqual([[41, '▲ $7.60']])
  expect(kids(columnOf(rows[2], 1)).map((b) => b.props.width)).toEqual([12, 12, 12, 9, 4])
  expect(offsets(columnOf(rows[2], 1))).toEqual([[0, '-4 h'], [12, '-3 h'], [24, '-2 h'], [36, '-1 h'], [45, 'now']])
  for (const r of [rows[1], rows[2]]) {
    const column = columnOf(r, 1)
    // The Boxes fill the column, and each Box has a width and does not shrink
    expect(kids(column).reduce((sum, b) => sum + b.props.width, 0)).toBe(49)
    expect(kids(column).every((b) => b.type === 'Box' && typeof b.props.width === 'number' && b.props.flexShrink === 0)).toBe(true)
    for (const t of all(column, 'Text')) expect(flat(t)).not.toMatch(/\s{2}/)
  }
  expect(all(columnOf(rows[1], 1), 'Text').map((t) => t.props)).toEqual([{ color: heatText(1), children: ['▲'] }, { children: [' $7.60'] }])
  expect(all(columnOf(rows[2], 1), 'Text').every((t) => t.props.dimColor === true)).toBe(true)
  // The labels are the same strings as on the terminal, and dimmed
  expect(rows.map((r) => flat(columnOf(r, 0)))).toEqual(['cache, last 4 h ', 'resumes         ', ' '.repeat(16)])
  const table = tablesOf(sessionEls(E, SESSION, undefined, 'desktop'))[2]
  expect([0, 1, 2].map((ri) => styleOf(table, ri, 0))).toEqual(Array(3).fill({ dimColor: true }))
})

test('the strip Svg has no triangle and is 14 high, with a resume, with two and with none in the strip', async () => {
  const strip = (resumes: SessionData['resumes']) => all(sessionEls(E, { ...SESSION, resumes }, undefined, 'desktop'), 'Svg')[3]
  for (const resumes of [[], SESSION.resumes, [{ at: T0 - 100 * MIN, cost: 3 }, ...SESSION.resumes], [{ at: T0 - 300 * MIN, cost: 2 }]]) {
    const svg = strip(resumes)
    expect(svg.props.alt).toBe('cache history of the last 4 hours')
    expect(svg.props.source).toBe(stripSvg(stripCells(SESSION.requests, T0)))
    expect(svg.props.source).toContain('width="432" height="14" viewBox="0 0 432 14"')
    expect(svg.props.source).not.toContain('<polygon')
  }
  // The grid holds the strip Svg only: the marks and the axis are Boxes with Text
  expect(all(historyRows(SESSION.resumes, 'desktop'), 'Svg')).toHaveLength(1)
  expect(all(historyRows(SESSION.resumes, 'desktop'), 'Svg')[0].props.source).not.toContain('▲')
})

test('one resume shows its mark in its cell with its cost, on both surfaces', async () => {
  // The resume 30 minutes ago ends cell 41. The label has 7 cells and ends in cell 47
  expectResumes(SESSION.resumes, [[41, '▲ $7.60']])
  // The first cell holds the 5 minutes after the start of the strip, and a resume there has room for its label
  expectResumes([{ at: T0 - 240 * MIN + 1, cost: 2 }], [[0, '▲ $2.00']])
  // The costs have two decimals and a thousands separator, as everywhere
  expectResumes([{ at: T0 - 100 * MIN, cost: 1234.5 }], [[27, '▲ $1,234.50']])
})

test('two resumes far apart show a label each, in the order of their cells', async () => {
  expectResumes([{ at: T0 - 190 * MIN, cost: 3.37 }, { at: T0 - 100 * MIN, cost: 0.27 }], [[9, '▲ $3.37'], [27, '▲ $0.27']])
  // The state keeps the resumes in time order, and the order of the input does not matter
  expectResumes([{ at: T0 - 100 * MIN, cost: 0.27 }, { at: T0 - 190 * MIN, cost: 3.37 }], [[9, '▲ $3.37'], [27, '▲ $0.27']])
  // A label needs its length and one free cell before the next mark: 8 cells here, so the next mark can be in cell 17
  expectResumes([{ at: T0 - 190 * MIN, cost: 3.37 }, { at: T0 - 150 * MIN, cost: 0.27 }], [[9, '▲ $3.37'], [17, '▲ $0.27']])
})

test('two resumes close together show only the mark where a label has no room, and the cost goes to the end of the row', async () => {
  // The cells 9 and 12: the label of the first would reach the second mark, so the first shows only its mark. Its cost follows the last label after 2 free cells
  expectResumes([{ at: T0 - 190 * MIN, cost: 3.37 }, { at: T0 - 175 * MIN, cost: 0.27 }], [[9, '▲'], [12, '▲ $0.27'], [21, '$3.37']])
  // The cells 9 and 16: the label of the first needs the cells 9 to 15 and the free cell 16, which is the next mark
  expectResumes([{ at: T0 - 190 * MIN, cost: 3.37 }, { at: T0 - 155 * MIN, cost: 0.27 }], [[9, '▲'], [16, '▲ $0.27'], [25, '$3.37']])
  // Three resumes: the costs of the marks without a label go in time order, separated by commas
  expectResumes(
    [{ at: T0 - 190 * MIN, cost: 3.37 }, { at: T0 - 185 * MIN, cost: 1.5 }, { at: T0 - 180 * MIN, cost: 0.27 }],
    [[9, '▲'], [10, '▲'], [11, '▲ $0.27'], [20, '$3.37, $1.50']],
  )
})

test('a resume in the last cells has no room for its label, and its cost goes before the mark', async () => {
  // A resume at the moment of the render is in cell 47. The list ends 2 cells before the mark
  expectResumes([{ at: T0, cost: 2 }], [[40, '$2.00'], [47, '▲']])
  // Cell 41 is the last cell where the label of a cost of 5 characters fits (see the test of one resume). In cell 42 it does not
  expectResumes([{ at: T0 - 25 * MIN, cost: 2 }], [[35, '$2.00'], [42, '▲']])
  // An earlier resume keeps its label. The list ends before the mark of the recent resume, since there is no room behind it
  expectResumes([{ at: T0 - 100 * MIN, cost: 3.37 }, { at: T0 - 5 * MIN, cost: 0.27 }], [[27, '▲ $3.37'], [39, '$0.27'], [46, '▲']])
})

test('many resumes in a few cells keep the newest costs behind an ellipsis, and the row keeps its width on both surfaces', async () => {
  const resumes = Array.from({ length: 8 }, (_, i) => ({ at: T0 - (40 - i) * MIN, cost: 100 + i + 0.5 }))
  // The 8 resumes are in the cells 39, 40 and 41. Three marks show, and the list holds the 4 newest costs
  expectResumes(resumes, [[1, '… $104.50, $105.50, $106.50, $107.50'], [39, '▲'], [40, '▲'], [41, '▲']])
  for (const surface of SURFACES) {
    for (const r of historyRows(resumes, surface)) expect(widthsOf(r)).toEqual([16, 49])
  }
  for (const r of historyRows(resumes)) expect(Array.from(flat(r))).toHaveLength(65)
})

test('without a resume in the strip the grid has the strip and the time axis, and no mark', async () => {
  for (const surface of SURFACES) {
    const rows = historyRows([], surface)
    expect(rows, surface).toHaveLength(2)
    expect(flat(columnOf(rows[1], 0)), surface).toBe(' '.repeat(16))
    expect(flat(tablesOf(sessionEls(E, { ...SESSION, resumes: [] }, undefined, surface))[2]), surface).not.toContain('resumes')
    expect(flat(tablesOf(sessionEls(E, { ...SESSION, resumes: [] }, undefined, surface))[2]), surface).not.toContain('▲')
  }
  expect(historyRows([]).map((r) => flat(r))).toEqual(['cache, last 4 h ' + ' '.repeat(41) + '█'.repeat(7) + ' ', ' '.repeat(16) + AXIS_TEXT])
})

test('the history grid shows the time axis under an empty strip, and a strip with no request', async () => {
  const none = { ...SESSION, requests: reqs([]), resumes: [] }
  expect(tableRows(tablesOf(sessionEls(E, none))[2]).map((r) => flat(r))).toEqual(['cache, last 4 h '.padEnd(16 + 49), ' '.repeat(16) + AXIS_TEXT])
})

test('the grid counts only the resumes inside the strip, also when the state still holds older ones', async () => {
  for (const surface of SURFACES) {
    // A resume older than 4 hours has no mark and no row
    const old = historyRows([{ at: T0 - 300 * MIN, cost: 2 }], surface)
    expect(old, surface).toHaveLength(2)
    expect(old.map((r) => flat(r)).join(''), surface).not.toContain('▲')
    expect(old.map((r) => flat(r)).join(''), surface).not.toContain('$2.00')
    // The start of the strip is out, one millisecond later it is in cell 0
    expect(historyRows([{ at: T0 - 240 * MIN, cost: 2 }], surface), surface).toHaveLength(2)
    expect(historyRows([{ at: T0 - 240 * MIN + 1, cost: 2 }], surface), surface).toHaveLength(3)
    // A resume after the moment of the render has no cell
    expect(historyRows([{ at: T0 + 1, cost: 2 }], surface), surface).toHaveLength(2)
  }
  // The cost of an old resume is not in the row of a newer one
  expectResumes([{ at: T0 - 300 * MIN, cost: 2 }, { at: T0 - 100 * MIN, cost: 3 }], [[27, '▲ $3.00']])
  const svgs = all(sessionEls(E, { ...SESSION, resumes: [{ at: T0 - 300 * MIN, cost: 2 }] }, undefined, 'desktop'), 'Svg')
  expect(svgs[3].props.source).not.toContain('<polygon')
  expect(svgs[3].props.alt).toBe('cache history of the last 4 hours')
})

test('the history grid drops its label column on a narrow pane and keeps the strip, the resumes and the axis', async () => {
  for (const surface of SURFACES) {
    const full = historyRows(SESSION.resumes, surface, E, 65)
    expect(full.map(widthsOf), surface).toEqual(Array(3).fill([16, 49]))
    const narrow = historyRows(SESSION.resumes, surface, E, 64)
    expect(narrow.map(widthsOf), surface).toEqual(Array(3).fill([49]))
  }
  const narrow = historyRows(SESSION.resumes, 'terminal', E, 62)
  expect(narrow.map((r) => flat(r))).toEqual([' '.repeat(41) + '█'.repeat(7) + ' ', ' '.repeat(41) + '▲ $7.60 ', AXIS_TEXT])
  expect(offsets(columnOf(historyRows(SESSION.resumes, 'desktop', E, 62)[1], 0))).toEqual([[41, '▲ $7.60']])
})

test('the cause table drops the bar and then the tokens, and the history grid drops its label', async () => {
  const widths = (index: number, available?: number) => tableRows(tablesOf(sessionEls(E, SESSION, available))[index]).map(widthsOf)
  for (const w of [widths(1), widths(1, 59)]) expect(w).toEqual(Array(4).fill([14, 21, 8, 10, 6]))
  expect(widths(1, 58)).toEqual(Array(4).fill([14, 8, 10, 6]))
  expect(widths(1, 38)).toEqual(Array(4).fill([14, 8, 10, 6]))
  expect(widths(1, 37)).toEqual(Array(4).fill([14, 10, 6]))
  expect(widths(1, 10)).toEqual(Array(4).fill([14, 10, 6]))
  expect(widths(2, 65)[0]).toEqual([16, 49])
  expect(widths(2, 64)).toEqual(Array(widths(2, 64).length).fill([49]))
  expect(widths(2, 62)).toEqual(Array(widths(2, 62).length).fill([49]))
  expect(widths(2, 10)[0]).toEqual([49])
  const dropped = tableRows(tablesOf(sessionEls(E, SESSION, 58))[1])
  expect(flat(dropped[1])).toBe('start'.padEnd(14) + '300k'.padStart(8) + '$1.00'.padStart(10) + '25%'.padStart(6))
  expect(all(sessionEls(E, SESSION, 58, 'desktop'), 'Svg')).toHaveLength(1)
})

const FUTURE: HistoryCell = { char: ' ', percent: null, isFuture: true }
const PAST_EMPTY: HistoryCell = { char: '░', percent: null, isFuture: false }

// The start of the week of WEEK: Sunday 11:00 in local time, 7 days before its reset
const SUNDAY_START = new Date(2026, 9, 4, 11, 0).getTime()
// The same week, started on Wednesday 11:00
const WEDNESDAY_START = new Date(2026, 9, 7, 11, 0).getTime()

// The 14 periods of a week that is in its fourth period: three readings, an empty period between them and ten periods to come
const WEEK: WeekData = {
  percent: 41,
  resetAt: new Date(2026, 9, 11, 11, 0).getTime(),
  projection: '100% on Fri 16:00',
  start: SUNDAY_START,
  history: [{ char: '▁', percent: 5, isFuture: false }, { char: '▃', percent: 41, isFuture: false }, PAST_EMPTY, { char: '▅', percent: 62.4, isFuture: false }, ...Array(10).fill(FUTURE)],
  byRepo: [{ name: 'webshop', cost: 432.64 }, { name: 'billing-service', cost: 96.31 }],
  byModelScope: [{ name: 'fable-5-1 main', cost: 331.52 }, { name: 'unknown-model main', cost: 0, isUnpriced: true }],
  total: 849,
}

const WHY: Breakdown = {
  total: 412_000,
  max: 1_000_000,
  categories: [{ name: 'Messages', tokens: 318_000 }, { name: 'System prompt', tokens: 6000 }],
  memoryFiles: [{ name: 'webshop/CLAUDE.md', tokens: 9800 }],
  mcpServers: [{ name: 'linear', tokens: 11_200 }],
  agents: [{ name: 'reviewer', tokens: 800 }],
}

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇']

// The text of a bar of 20 cells in a column of 21
const barText = (f: number) => tubeCells(f, 20).map((c) => c.char).join('') + ' '

test('the Week tab has the head grid, the repo table and the model table with a blank line between them', async () => {
  const tree = weekEls(E, WEEK)
  const parts = (tree as Node).props.children as Node[]
  expect(parts.map((p) => p.type)).toEqual(['Box', 'Text', 'Box', 'Text', 'Box'])
  expect([flat(parts[1]), flat(parts[3])]).toEqual([' ', ' '])
  expect([0, 1, 2].map((i) => tablesOf(tree)[i])).toEqual([parts[0], parts[2], parts[4]])
  expect(tableRows(parts[0] as Node)).toHaveLength(5)
  expect(tableRows(parts[2] as Node)).toHaveLength(3)
  expect(tableRows(parts[4] as Node)).toHaveLength(3)
})

test('the Week head grid shows the week, the reset, the projection, the history and the day axis in the columns of the tables', async () => {
  const head = tablesOf(weekEls(E, WEEK))[0]
  const rows = tableRows(head).map((r) => flat(r))
  expect(rows[0]).toBe('week'.padEnd(26) + barText(0.41) + ''.padStart(10) + '41%'.padStart(6))
  expect(rows[1]).toBe('resets'.padEnd(26) + 'Sun 11:00'.padEnd(21) + ' '.repeat(16))
  expect(rows[2]).toBe('at the current rate'.padEnd(26) + '100% on Fri 16:00'.padEnd(21) + ' '.repeat(16))
  expect(rows[3]).toBe('week used, over time'.padEnd(26) + '▁▃░▅' + '·'.repeat(10) + ' '.repeat(7) + ' '.repeat(16))
  expect(rows[4]).toBe(' '.repeat(26) + 'S M T W T F S '.padEnd(21) + ' '.repeat(16))
  // The label column is dimmed, the values are not
  for (let ri = 0; ri < 5; ri++) expect(styleOf(head, ri, 0)).toEqual({ dimColor: true })
  expect([1, 2].map((ri) => styleOf(head, ri, 1))).toEqual([{}, {}])
  const percent = ((tableRows(head)[0].props.children as Node[])[3].props.children as Node[])[0]
  expect(percent.props).toEqual({ bold: true, color: heatText(0.41), children: ['   41%'] })
  const spark = all(tableRows(head)[3], 'Text').filter((t) => SPARK_CHARS.includes(flat(t)))
  expect(spark.map((t) => t.props.color)).toEqual([heat(0.05), heat(0.41), heat(0.624)])
})

test('the Week head grid shows the history row only when a period has a reading', async () => {
  const labels = (history: HistoryCell[]) => tableRows(tablesOf(weekEls(E, { ...WEEK, history }))[0]).map((r) => flat(r).slice(0, 12).trim())
  // The axis row has no label
  expect(labels(WEEK.history)).toEqual(['week', 'resets', 'at the curre', 'week used, o', ''])
  // A week without a reading has past empty cells and future cells, and no history row
  const none = [...Array(5).fill(PAST_EMPTY), ...Array(9).fill(FUTURE)]
  expect(labels(none)).toEqual(['week', 'resets', 'at the curre'])
  expect(labels([])).toEqual(['week', 'resets', 'at the curre'])
  expect(labels(Array(14).fill(FUTURE))).toEqual(['week', 'resets', 'at the curre'])
  // One reading is enough
  expect(labels([...none.slice(0, 4), { char: '▁', percent: 5, isFuture: false }, ...none.slice(5)])).toHaveLength(5)
  // On the desktop the meter is the only Svg of the head grid, and on both surfaces no text names the history or the days
  const head = (surface: string) => tablesOf(weekEls(E, { ...WEEK, history: none }, undefined, surface))[0]
  expect(all(head('desktop'), 'Svg').map((v) => v.props.alt)).toEqual(['week 41% used'])
  for (const surface of SURFACES) {
    for (const t of all(head(surface), 'Text')) expect(flat(t), surface).not.toMatch(/over time|^(Su|Mo|Tu|We|Th|Fr|Sa)$/)
    expect(flat(head(surface)), surface).not.toContain('S M T W')
  }
})

test('the Week head grid draws the history of a week that started on Sunday 11:00, on Tuesday 18:00, as 14 cells', async () => {
  const start = Date.UTC(2026, 9, 4, 11, 0)
  const readings = [{ at: Date.UTC(2026, 9, 6, 17, 0), kind: 'seven_day', percentUsed: 41 }]
  const history = historyCells(readings, start, Date.UTC(2026, 9, 6, 18, 0))
  const row = tableRows(tablesOf(weekEls(E, { ...WEEK, history }))[0])[3]
  expect(flat(row)).toBe('week used, over time'.padEnd(26) + '░░░░▄' + '·'.repeat(9) + ' '.repeat(7) + ' '.repeat(16))
  const texts = all((row.props.children as Node[])[1], 'Text')
  expect(texts.map((t) => t.props.children[0]).join('')).toBe('░░░░▄' + '·'.repeat(9) + ' '.repeat(7))
  expect(texts.slice(0, 4).every((t) => t.props.dimColor === true && t.props.color === undefined)).toBe(true)
  expect(texts[4].props).toEqual({ color: heat(0.41), children: ['▄'] })
  // The 9 future periods are dimmed dots, and the padding of the column is a plain space
  expect(texts.slice(5, 14).every((t) => t.props.dimColor === true && t.props.color === undefined && t.props.children[0] === '·')).toBe(true)
  expect(texts[14].props).toEqual({ children: [' '.repeat(7)] })
})

const SUNDAY_DAYS = ['S ', 'M ', 'T ', 'W ', 'T ', 'F ', 'S ']
const WEDNESDAY_DAYS = ['W ', 'T ', 'F ', 'S ', 'S ', 'M ', 'T ']
const AXIS_CASES: [string, number, string[]][] = [['a week that starts on Sunday', SUNDAY_START, SUNDAY_DAYS], ['a week that starts on Wednesday', WEDNESDAY_START, WEDNESDAY_DAYS]]

// The row of the day axis is the row under the history row: the head grid has the week, the reset, the projection, the history and the axis
const axisRow = (tree: unknown) => tableRows(tablesOf(tree)[0])[4]
const columnsOf = (row: Node) => row.props.children as Node[]

test('the day axis on the terminal has the two-letter name of each day over its 2 cells, dimmed, from the weekday of the start of the week', async () => {
  for (const [name, start, days] of AXIS_CASES) {
    const row = axisRow(weekEls(E, { ...WEEK, start }))
    const [label, meter] = columnsOf(row)
    // The label cell is empty, and the names sit in the meter column, followed by the padding of the column
    expect(flat(label), name).toBe(' '.repeat(26))
    expect(flat(meter), name).toBe(days.join('') + ' '.repeat(7))
    expect(flat(row), name).toBe(' '.repeat(26) + days.join('').padEnd(21) + ' '.repeat(16))
    // Day i starts at cell 2 * i of the column, under the first of its two history cells
    const cells = Array.from(flat(meter))
    for (const [i, day] of days.entries()) expect(cells.slice(2 * i, 2 * i + 2).join(''), name + ', day ' + i).toBe(day)
    const texts = all(meter, 'Text')
    expect(texts.map((t) => flat(t)), name).toEqual([...days, ' '.repeat(7)])
    expect(texts.slice(0, 7).map((t) => t.props), name).toEqual(days.map((day) => ({ dimColor: true, children: [day] })))
    // The history row above it has the same widths
    expect(widthsOf(row), name).toEqual([26, 21, 10, 6])
  }
})

test('the day axis on the desktop is 7 Boxes of 2 cells with a dimmed name each, and no padded Text and no Svg', async () => {
  for (const [name, start, days] of AXIS_CASES) {
    const tree = weekEls(E, { ...WEEK, start }, undefined, 'desktop')
    const row = axisRow(tree)
    const [label, meter] = columnsOf(row)
    expect(flat(label), name).toBe(' '.repeat(26))
    expect(widthsOf(row), name).toEqual([26, 21, 10, 6])
    const boxes = meter.props.children as Node[]
    expect(boxes, name).toHaveLength(7)
    for (const [i, b] of boxes.entries()) {
      // The letter sits in the middle of the 2 cells of its day, because the letters of a proportional font differ in width
      expect([b.type, b.props.width, b.props.flexShrink, b.props.justifyContent], name + ', day ' + i).toEqual(['Box', 2, 0, 'center'])
      expect(b.props.children, name + ', day ' + i).toEqual([{ type: 'Text', props: { dimColor: true, children: [days[i].trim()] } }])
    }
    // The boxes add up to the 14 cells of the history Svg box, so that day i starts at cell 2 * i
    expect(boxes.reduce((sum, b) => sum + b.props.width, 0), name).toBe(14)
    expect(all(meter, 'Text').map((t) => flat(t)), name).toEqual(days.map((d) => d.trim()))
    expect(all(meter, 'Svg'), name).toHaveLength(0)
    // The history Svg is the same 14 cells wide
    const history = tableRows(tablesOf(tree)[0])[3]
    expect((columnsOf(history)[1].props.children as Node[])[0].props.width, name).toBe(14)
  }
})

test('the day axis follows the weekday of the start of the week, whatever the hour of the start', async () => {
  const days = (start: number) => flat(columnsOf(axisRow(weekEls(E, { ...WEEK, start })))[1]).trim()
  // Monday 2026-10-05 at 00:00, 11:00 and 23:59 in local time
  for (const [h, m] of [[0, 0], [11, 0], [23, 59]]) expect(days(new Date(2026, 9, 5, h, m).getTime()), h + ':' + m).toBe('M T W T F S S')
})

test('weekData takes the pace of the week up to the weekly reading, not up to now', async () => {
  // The week started on Sunday 11:00 in local time. The reading came on Tuesday 11:00, 48 hours later, at 50%
  const readAt = new Date(2026, 9, 6, 11, 0).getTime()
  const reading = { at: readAt, kind: 'seven_day', percentUsed: 50, resetsAt: new Date(2026, 9, 11, 11, 0).toISOString() }
  const snap = { v: 1, key: 'run:a:1', sessionId: 'a', repo: 'webshop', model: 'claude-fable-5-1', updatedAt: readAt, lastMainRequestAt: readAt, contextTokens: 1000, isWorking: false, readings: [reading], hours: {} } as Snapshot
  // 100% after 96 hours: Thursday 11:00. Seven hours later the time stays, and the pace up to now would give Thursday 21:00
  expect(weekData([snap], readAt).projection).toBe('100% on Thu 11:00')
  expect(weekData([snap], readAt + 7 * 60 * MIN).projection).toBe('100% on Thu 11:00')
  // A later measure that kept the percent ends the pace at its time: 50% after 72 hours gives 100% after 144 hours, on Saturday 11:00
  const held = { ...snap, readings: [{ ...reading, seenAt: readAt + 24 * 60 * MIN }] } as Snapshot
  expect(weekData([held], readAt + 25 * 60 * MIN).projection).toBe('100% on Sat 11:00')
  // On Thursday 11:00 the time has passed, and the row is left out
  expect(weekData([snap], new Date(2026, 9, 8, 11, 0).getTime()).projection).toBe('')
  expect(flat(weekEls(E, weekData([snap], new Date(2026, 9, 8, 12, 0).getTime())))).not.toContain('at the current rate')
})

test('weekData passes the start of the week to the view, so that the day axis starts at its weekday', async () => {
  // The reset is Sunday 11:00 in local time, so the week started on the Sunday before
  const now = new Date(2026, 9, 6, 18, 0).getTime()
  const reading = { at: now - 60 * MIN, kind: 'seven_day', percentUsed: 41, resetsAt: new Date(2026, 9, 11, 11, 0).toISOString() }
  const snap = { v: 1, key: 'run:a:1', sessionId: 'a', repo: 'webshop', model: 'claude-fable-5-1', updatedAt: now, lastMainRequestAt: now, contextTokens: 1000, isWorking: false, readings: [reading], hours: {} } as Snapshot
  const data = weekData([snap], now)
  expect(data.start).toBe(SUNDAY_START)
  expect(data.history).toHaveLength(14)
  expect(flat(columnsOf(axisRow(weekEls(E, data)))[1])).toBe('S M T W T F S ' + ' '.repeat(7))
  // After the reset the week is the next one, and its start is the reset: the axis starts on the Sunday of the reset
  const later = weekData([snap], new Date(2026, 9, 13, 9, 0).getTime())
  expect(later.start).toBe(new Date(2026, 9, 11, 11, 0).getTime())
  // Without a reading the week starts 7 days before now
  expect(weekData([], now).start).toBe(now - 7 * 24 * 60 * MIN)
})

test('the Week head grid shows n/a in a dimmed row without a percent, and leaves out empty rows', async () => {
  const head = tablesOf(weekEls(E, { ...WEEK, percent: null, resetAt: null, projection: '', history: [] }))[0]
  expect(tableRows(head)).toHaveLength(1)
  expect(flat(tableRows(head)[0])).toBe('week'.padEnd(26) + 'n/a'.padEnd(21) + ' '.repeat(16))
  expect([0, 1].map((ci) => styleOf(head, 0, ci))).toEqual([{ dimColor: true }, { dimColor: true }])
  const noReset = tablesOf(weekEls(E, { ...WEEK, resetAt: null, projection: '', history: [] }))[0]
  expect(tableRows(noReset)).toHaveLength(1)
  expect(all(noReset, 'Text').some((t) => flat(t).includes('resets'))).toBe(false)
  const both = tablesOf(weekEls(E, { ...WEEK, percent: null }))[0]
  expect(tableRows(both).map((r) => flat(r).slice(0, 12).trim())).toEqual(['week', 'resets', 'at the curre', 'week used, o', ''])
  expect(flat(weekEls(E, { ...WEEK, percent: null, resetAt: null, projection: '', history: [], byRepo: [], byModelScope: [], total: 0 }))).toContain('week')
})

test('the Week tab has the same widths in every row of its grids and tables on both surfaces', async () => {
  expect(total(WEEK_COLUMNS)).toBe(63)
  for (const surface of SURFACES) {
    const tables = tablesOf(weekEls(E, WEEK, undefined, surface))
    expect(tables).toHaveLength(3)
    for (const table of tables) {
      for (const r of tableRows(table)) {
        expect(widthsOf(r)).toEqual([26, 21, 10, 6])
        expect((r.props.children as Node[]).every((c) => c.props.flexShrink === 0)).toBe(true)
        if (surface === 'terminal') expect(Array.from(flat(r))).toHaveLength(63)
      }
    }
  }
})

test('the Week tables draw the share bars, the unpriced row and the header', async () => {
  const [, repos, models] = tablesOf(weekEls(E, WEEK))
  expect(tableRows(repos).map((r) => flat(r))).toEqual([
    'by repo'.padEnd(26) + ' '.repeat(21) + 'cost'.padStart(10) + 'share'.padStart(6),
    'webshop'.padEnd(26) + barText(432.64 / 849) + '$432.64'.padStart(10) + '51%'.padStart(6),
    'billing-service'.padEnd(26) + barText(96.31 / 849) + '$96.31'.padStart(10) + '11%'.padStart(6),
  ])
  expect(styleOf(repos, 0, 0)).toEqual({ dimColor: true })
  expect(flat(tableRows(models)[0]).startsWith('by model and scope')).toBe(true)
  expect(flat(tableRows(models)[1])).toBe('fable-5-1 main'.padEnd(26) + barText(331.52 / 849) + '$331.52'.padStart(10) + '39%'.padStart(6))
  // A model without a price has an empty bar, no share and no part in the bars
  expect(flat(tableRows(models)[2])).toBe('unknown-model main'.padEnd(26) + '░'.repeat(20) + ' ' + 'unpriced'.padStart(10) + ' '.repeat(6))
})

test('a Week share row shows two decimals for every amount, and the thousands separator from 1,000 dollars', async () => {
  const week: WeekData = { ...WEEK, byRepo: [{ name: 'webshop', cost: 1234.56 }, { name: 'billing-service', cost: 90 }, { name: 'report-exporter', cost: 3.5 }], byModelScope: [], total: 1328.06 }
  for (const surface of SURFACES) {
    const rows = tableRows(tablesOf(weekEls(E, week, undefined, surface))[1])
    const costs = rows.slice(1).map((r) => flat((r.props.children as Node[])[2]))
    expect(costs).toEqual(['$1,234.56'.padStart(10), '$90.00'.padStart(10), '$3.50'.padStart(10)])
  }
  const lines = tableRows(tablesOf(weekEls(E, week))[1]).map((r) => flat(r))
  expect(lines[1]).toBe('webshop'.padEnd(26) + barText(1234.56 / 1328.06) + '$1,234.56'.padStart(10) + '93%'.padStart(6))
  expect(lines[2]).toBe('billing-service'.padEnd(26) + barText(90 / 1328.06) + '$90.00'.padStart(10) + '7%'.padStart(6))
  expect(lines[3]).toBe('report-exporter'.padEnd(26) + barText(3.5 / 1328.06) + '$3.50'.padStart(10) + '0%'.padStart(6))
})

test('every money column holds $9,999.99 and the one free cell', async () => {
  const money = [NOW_COLUMNS[4], NOW_COLUMNS[5], SESSION_COLUMNS[7], CAUSE_COLUMNS[3], WEEK_COLUMNS[2]]
  expect(money.map((c) => c.width)).toEqual([10, 10, 10, 10, 10])
  for (const c of money) expect(cell('$9,999.99', c)).toBe(' $9,999.99')
})

test('no amount up to $9,999.99 is cut in any money cell of the four tabs', async () => {
  const count = (text: string) => text.split('$9,999.99').length - 1
  const now = flat(nowEls(E, [row({ last60: 9999.99, today: 9999.99 })], T0))
  expect(count(now)).toBe(2)
  expect(now).not.toContain('…')
  const big = { ...EMPTY, requests: 84, cost: 9999.99 }
  const session = flat(
    sessionEls(E, {
      ...SESSION,
      rows: [{ model: 'claude-fable-5-1', scope: 'main', counts: big }],
      total: big,
      causes: { start: { tokens: 1, cost: 9999.99 }, growth: { tokens: 1, cost: 9999.99 }, resume: { tokens: 1, cost: 9999.99 } },
      usd: 9999.99,
    }),
  )
  // The row, the total, the reported row and the three causes
  expect(count(session)).toBe(6)
  expect(session).not.toContain('…')
  const week = flat(weekEls(E, { ...WEEK, byRepo: [{ name: 'webshop', cost: 9999.99 }], byModelScope: [{ name: 'fable-5-1 main', cost: 9999.99 }], total: 9999.99 }))
  expect(count(week)).toBe(2)
  expect(week).not.toContain('…')
})

test('on the desktop the Week tab holds one Svg for the meter, one for the history and one for each share row, and no bar character in a Text', async () => {
  const tree = weekEls(E, WEEK, undefined, 'desktop')
  const svgs = all(tree, 'Svg')
  expect(svgs.map((v) => v.props.alt)).toEqual(['week 41% used', 'week history, highest 62%', 'share 51%', 'share 11%', 'share 39%', 'unpriced'])
  expect(svgs.map((v) => v.props.source)).toEqual([barSvg(0.41, 20), sparkSvg(WEEK.history), barSvg(432.64 / 849, 20), barSvg(96.31 / 849, 20), barSvg(331.52 / 849, 20), barSvg(0, 20)])
  expect(svgs.every((v) => v.props.width === undefined && v.props.height === undefined)).toBe(true)
  const boxes = all(tree, 'Box').filter((b) => (b.props.children as Node[]).some((c) => c.type === 'Svg'))
  expect(boxes.map((b) => [b.props.width, b.props.flexShrink])).toEqual([[20, 0], [14, 0], [20, 0], [20, 0], [20, 0], [20, 0]])
  for (const t of all(tree, 'Text')) for (const ch of [...BAR_CHARS, ...SPARK_CHARS]) expect(flat(t)).not.toContain(ch)
  const none = weekEls(E, { ...WEEK, percent: null, history: [], byRepo: [], byModelScope: [] }, undefined, 'desktop')
  expect(all(none, 'Svg')).toHaveLength(0)
})

test('on the terminal the Week tab holds no Svg and draws the bars and the history as text', async () => {
  for (const tree of [weekEls(E, WEEK), weekEls(E, WEEK, undefined, 'terminal'), weekEls(NO_SVG, WEEK, undefined, 'desktop')]) {
    expect(all(tree, 'Svg')).toHaveLength(0)
    expect(flat(tree)).toContain(barText(0.41))
    expect(flat(tree)).toContain('▁▃░▅')
  }
})

test('the Week head grid drops the empty column first, and the share tables drop the bar column', async () => {
  const widths = (index: number, available?: number, surface = 'terminal') => tableRows(tablesOf(weekEls(E, WEEK, available, surface))[index]).map(widthsOf)
  expect(widths(0, 63)[0]).toEqual([26, 21, 10, 6])
  // The head grid has 5 rows: the week, the reset, the projection, the history and the day axis
  expect(widths(0, 62)).toEqual(Array(5).fill([26, 21, 6]))
  expect(widths(0, 53)[0]).toEqual([26, 21, 6])
  expect(widths(0, 10)[0]).toEqual([26, 21, 6])
  expect(widths(1, 63)[0]).toEqual([26, 21, 10, 6])
  expect(widths(1, 62)).toEqual(Array(3).fill([26, 10, 6]))
  expect(widths(2, 10)[0]).toEqual([26, 10, 6])
  expect(fitColumns(WEEK_COLUMNS.map((c) => c.width), [1], 62)).toEqual([0, 2, 3])
  const text = flat(weekEls(E, WEEK, 62)).split('\n')
  expect(text[0]).toBe('week'.padEnd(26) + barText(0.41) + '41%'.padStart(6))
  expect(text.find((l) => l.startsWith('webshop'))).toBe('webshop'.padEnd(26) + '$432.64'.padStart(10) + '51%'.padStart(6))
  // The head grid keeps its two Svg and the tables lose theirs
  expect(all(weekEls(E, WEEK, 62, 'desktop'), 'Svg')).toHaveLength(2)
})

test('the Why tab shows a wait text without a breakdown', async () => {
  expect(flat(whyEls(E, null))).toBe('Reading the context breakdown…')
  expect(flat(whyEls(E, null, 40, 'desktop'))).toBe('Reading the context breakdown…')
})

test('the Why tab has the context row, the category table and one table for each list with blank lines between them', async () => {
  const tree = whyEls(E, WHY)
  const parts = (tree as Node).props.children as Node[]
  expect(parts.map((p) => p.type)).toEqual(['Box', 'Text', 'Box', 'Text', 'Box', 'Text', 'Box', 'Text', 'Box'])
  expect(parts.filter((p) => p.type === 'Text').map((p) => flat(p))).toEqual([' ', ' ', ' ', ' '])
  expect(tablesOf(tree)).toHaveLength(5)
  expect(tableRows(parts[0])).toHaveLength(1)
  expect(tableRows(parts[2])).toHaveLength(3)
  expect([4, 6, 8].map((i) => flat(tableRows(parts[i])[0]).slice(0, 20).trim())).toEqual(['largest memory files', 'MCP servers', 'custom agents'])
  const some = whyEls(E, { ...WHY, mcpServers: [], agents: [] })
  expect(tablesOf(some)).toHaveLength(3)
  expect(flat(some)).not.toContain('MCP servers')
  expect(flat(some)).not.toContain('custom agents')
  expect(tablesOf(whyEls(E, { ...WHY, memoryFiles: [], mcpServers: [], agents: [] }))).toHaveLength(2)
})

test('the Why context row shows the max, the bar, the total in bold and the percent in the text colour of heat', async () => {
  const context = tablesOf(whyEls(E, WHY))[0]
  expect(flat(tableRows(context)[0])).toBe('context of 1.0M'.padEnd(26) + barText(0.412) + '412k'.padStart(9) + '41%'.padStart(7))
  expect(styleOf(context, 0, 0)).toEqual({ dimColor: true })
  const cells = tableRows(context)[0].props.children as Node[]
  expect((cells[2].props.children as Node[])[0].props).toEqual({ bold: true, children: ['     412k'] })
  expect((cells[3].props.children as Node[])[0].props).toEqual({ bold: true, color: heatText(0.412), children: ['    41%'] })
  // Without a max there is an empty bar and no percent
  const unknown = tablesOf(whyEls(E, { ...WHY, max: 0 }))[0]
  expect(flat(tableRows(unknown)[0])).toBe('context'.padEnd(26) + '░'.repeat(20) + ' ' + '412k'.padStart(9) + ' '.repeat(7))
  expect(all(whyEls(E, { ...WHY, max: 0 }, undefined, 'desktop'), 'Svg')[0].props.source).toBe(barSvg(0, 20))
})

test('the Why category table and the lists show tokens and the share of the total', async () => {
  const [, categories, files, servers, agents] = tablesOf(whyEls(E, WHY))
  expect(tableRows(categories).map((r) => flat(r))).toEqual([
    'category'.padEnd(26) + ' '.repeat(21) + 'tokens'.padStart(9) + 'share'.padStart(7),
    'Messages'.padEnd(26) + barText(318 / 412) + '318k'.padStart(9) + '77%'.padStart(7),
    'System prompt'.padEnd(26) + barText(6 / 412) + '6.0k'.padStart(9) + '1%'.padStart(7),
  ])
  expect(styleOf(categories, 0, 0)).toEqual({ dimColor: true })
  expect(tableRows(files).map((r) => flat(r))).toEqual([
    'largest memory files'.padEnd(47) + 'tokens'.padStart(9) + 'share'.padStart(7),
    'webshop/CLAUDE.md'.padEnd(47) + '9.8k'.padStart(9) + '2%'.padStart(7),
  ])
  expect(styleOf(files, 0, 0)).toEqual({ dimColor: true })
  expect(flat(tableRows(servers)[1])).toBe('linear'.padEnd(47) + '11.2k'.padStart(9) + '3%'.padStart(7))
  // 800 of 412000 tokens rounds to 0%
  expect(flat(tableRows(agents)[1])).toBe('reviewer'.padEnd(47) + '800'.padStart(9) + '0%'.padStart(7))
  // Without a total there is no share
  const none = tablesOf(whyEls(E, { ...WHY, total: 0, categories: [{ name: 'Messages', tokens: 0 }] }))
  expect(flat(tableRows(none[1])[1])).toBe('Messages'.padEnd(26) + '░'.repeat(20) + ' ' + '0'.padStart(9) + ' '.repeat(7))
})

test('the Why tab has the same widths in every row of its tables on both surfaces', async () => {
  expect(total(WHY_COLUMNS)).toBe(63)
  for (const surface of SURFACES) {
    const tables = tablesOf(whyEls(E, WHY, undefined, surface))
    expect(tables).toHaveLength(5)
    for (const [i, table] of tables.entries()) {
      for (const r of tableRows(table)) {
        expect(widthsOf(r)).toEqual(i < 2 ? [26, 21, 9, 7] : [47, 9, 7])
        expect((r.props.children as Node[]).every((c) => c.props.flexShrink === 0)).toBe(true)
        if (surface === 'terminal') expect(Array.from(flat(r))).toHaveLength(63)
      }
    }
  }
})

test('on the desktop the Why tab holds one Svg for the context and one for each category, and no bar character in a Text', async () => {
  const tree = whyEls(E, WHY, undefined, 'desktop')
  const svgs = all(tree, 'Svg')
  expect(svgs.map((v) => v.props.alt)).toEqual(['context 41% used', 'share 77%', 'share 1%'])
  expect(svgs.map((v) => v.props.source)).toEqual([barSvg(0.412, 20), barSvg(318 / 412, 20), barSvg(6 / 412, 20)])
  expect(svgs.every((v) => v.props.width === undefined && v.props.height === undefined)).toBe(true)
  const boxes = all(tree, 'Box').filter((b) => (b.props.children as Node[]).some((c) => c.type === 'Svg'))
  expect(boxes.map((b) => [b.props.width, b.props.flexShrink])).toEqual([[20, 0], [20, 0], [20, 0]])
  for (const t of all(tree, 'Text')) for (const ch of BAR_CHARS) expect(flat(t)).not.toContain(ch)
})

test('on the terminal the Why tab holds no Svg and draws the bars as text', async () => {
  for (const tree of [whyEls(E, WHY), whyEls(E, WHY, undefined, 'terminal'), whyEls(NO_SVG, WHY, undefined, 'desktop')]) {
    expect(all(tree, 'Svg')).toHaveLength(0)
    expect(flat(tree)).toContain(barText(0.412))
  }
})

test('the Why tab drops the bar and then the share in every table, and the lists follow', async () => {
  const widths = (available?: number, surface = 'terminal') => tablesOf(whyEls(E, WHY, available, surface)).map((t) => tableRows(t).map(widthsOf))
  const kept = (w: number[][][]) => w.map((rows) => rows[0])
  expect(kept(widths(63))).toEqual([[26, 21, 9, 7], [26, 21, 9, 7], [47, 9, 7], [47, 9, 7], [47, 9, 7]])
  expect(kept(widths(62))).toEqual([[26, 9, 7], [26, 9, 7], [26, 9, 7], [26, 9, 7], [26, 9, 7]])
  expect(kept(widths(42))).toEqual([[26, 9, 7], [26, 9, 7], [26, 9, 7], [26, 9, 7], [26, 9, 7]])
  expect(kept(widths(41))).toEqual([[26, 9], [26, 9], [26, 9], [26, 9], [26, 9]])
  expect(kept(widths(10))).toEqual([[26, 9], [26, 9], [26, 9], [26, 9], [26, 9]])
  for (const rows of widths(62)) for (const w of rows) expect(w).toEqual(rows[0])
  const text = flat(whyEls(E, WHY, 62))
  expect(text).toContain('context of 1.0M'.padEnd(26) + '412k'.padStart(9) + '41%'.padStart(7))
  expect(text).toContain('webshop/CLAUDE.md'.padEnd(26) + '9.8k'.padStart(9) + '2%'.padStart(7))
  expect(flat(whyEls(E, WHY, 41)).split('\n')[0]).toBe('context of 1.0M'.padEnd(26) + '412k'.padStart(9))
  expect(flat(whyEls(E, WHY, 41))).toContain('webshop/CLAUDE.md'.padEnd(26) + '9.8k'.padStart(9) + '\n')
  expect(Array.from(flat(tablesOf(whyEls(E, WHY, 41))[2])).length).toBe(2 * 35 + 1)
  // The desktop keeps the bars only while their column is kept
  expect(all(whyEls(E, WHY, 63, 'desktop'), 'Svg')).toHaveLength(3)
  expect(all(whyEls(E, WHY, 62, 'desktop'), 'Svg')).toHaveLength(0)
})

test('the tabs are five plain buttons with digit hotkeys, and the fifth is Help', async () => {
  const pressed: number[] = []
  const tree = tabsEls(E, 2, (n) => {
    pressed.push(n)
  })
  const buttons = all(tree, 'Button')
  expect(TAB_LABELS).toEqual(['Now', 'Session', 'Week', 'Why', 'Help'])
  expect(buttons.map((b) => b.props.label)).toEqual(TAB_LABELS)
  expect(buttons.map((b) => b.props.key)).toEqual(['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'])
  expect(buttons.map((b) => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5'])
  expect(buttons.map((b) => b.props.dimColor)).toEqual([true, false, true, true, true])
  buttons[3].props.onPress()
  buttons[4].props.onPress()
  expect(pressed).toEqual([4, 5])
  expect(all(tabsEls(E, 5, () => undefined), 'Button').map((b) => b.props.dimColor)).toEqual([true, true, true, true, false])
})

test('a model without a price shows unpriced in the Session, Now and Week tables', async () => {
  const unknown = { model: 'unknown-model', scope: 'main', counts: { ...EMPTY, requests: 3, cost: 0 } }
  const cells = sessionCells(unknown, { ...EMPTY, cost: 5 })
  expect(cells[7]).toBe('unpriced')
  expect(cells[8]).toBe('')
  expect(sessionCells({ ...unknown, model: 'claude-fable-5-1', counts: { ...EMPTY, cost: 5 } }, { ...EMPTY, cost: 5 })[7]).toBe('$5.00')
  const now = nowCells(row({ model: 'unknown-model' }), T0)
  expect([now[4], now[5]]).toEqual(['unpriced', 'unpriced'])
  expect([nowCells(row({ model: '' }), T0)[4], nowCells(row({}), T0)[4]]).toEqual(['$6.10', '$6.10'])
  const week = flat(
    weekEls(E, {
      percent: null,
      resetAt: null,
      projection: '',
      history: [],
      byRepo: [{ name: 'webshop', cost: 10 }],
      byModelScope: [{ name: 'unknown-model main', cost: 0, isUnpriced: true }, { name: 'fable-5-1 main', cost: 10 }],
      total: 10,
    }),
  )
  const unpricedLine = week.split('\n').find((l) => l.startsWith('unknown-model main'))
  expect(unpricedLine).toBe('unknown-model main'.padEnd(26) + '░'.repeat(20) + ' ' + 'unpriced'.padStart(10) + ' '.repeat(6))
  expect(week).toContain('$10.00')
})

const ESTIMATED_ROWS = [
  { model: 'claude-opus-5-6', scope: 'main', counts: { ...EMPTY, requests: 3, input: 90, cacheRead: 40_000, cost: 5 } },
  { model: 'claude-haiku-4-6', scope: 'Explore', counts: { ...EMPTY, requests: 2, input: 10, cacheRead: 10_000, cost: 1 } },
  { model: 'claude-sonnet-6[1m]', scope: 'general-purpose', counts: { ...EMPTY, requests: 1, input: 10, cacheRead: 10_000, cost: 1 } },
]

test('the Session cells mark the model name of a cost from a fallback price with ≈, and no other cell', async () => {
  const total = { ...EMPTY, cost: 10 }
  const [opus] = ESTIMATED_ROWS
  const cells = sessionCells(opus, total)
  expect(cells[0]).toBe('opus-5-6 ≈')
  expect([cells[1], cells[2], cells[7], cells[8]]).toEqual(['main', '3', '$5.00', '50%'])
  expect(cells.filter((c) => c.includes('≈'))).toEqual(['opus-5-6 ≈'])
  // The name is cut with an ellipsis and the mark stays whole
  expect(sessionCells(ESTIMATED_ROWS[1], total)[0]).toBe('haiku-4… ≈')
  expect(sessionCells(ESTIMATED_ROWS[2], total)[0]).toBe('sonnet-… ≈')
  // No mark for an exact price, a dated or [1m] variant of it, and a model without a price
  for (const model of ['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5[1m]', 'claude-mythos-1']) {
    expect(sessionCells({ ...opus, model }, total).join('')).not.toContain('≈')
  }
})

test('the Session table shows ≈ after the name of an estimated model on both surfaces, keeps its widths, and has no mark in the total and the other tabs', async () => {
  const data: SessionData = { ...SESSION, rows: [...SESSION.rows, ...ESTIMATED_ROWS] }
  for (const surface of SURFACES) {
    const main = tablesOf(sessionEls(E, data, undefined, surface))[0]
    const lines = tableRows(main).map((r) => flat(r))
    for (const l of lines) expect(Array.from(l), surface).toHaveLength(total(SESSION_COLUMNS))
    // The marked name keeps the cell of the model column: the scope starts at the same cell as in the other rows
    expect(lines[1].startsWith('fable-5-1  main'), surface).toBe(true)
    expect(lines[3].startsWith('opus-5-6 ≈ main'), surface).toBe(true)
    expect(lines[4].startsWith('haiku-4… ≈ Explore'), surface).toBe(true)
    expect(lines[5].startsWith('sonnet-… ≈ general-purpose'), surface).toBe(true)
    // The model cell of a marked row is the first column Box of the row, 11 cells wide
    const name = (rows: Node[], i: number) => flat((rows[i].props.children as Node[])[0])
    expect(name(tableRows(main), 3)).toBe('opus-5-6 ≈ ')
    expect(name(tableRows(main), 4)).toBe('haiku-4… ≈ ')
    // Only the three estimated rows have the mark: not the exact rows, the total, the reported row or the header
    expect(lines.map((l) => l.includes('≈'))).toEqual([false, false, false, true, true, true, false, false])
    expect(flat(sessionEls(E, data, undefined, surface)).split('≈').length - 1, surface).toBe(3)
  }
  // The Now table mixes the models of a session: no mark, also for an estimated model
  for (const surface of SURFACES) {
    const now = flat(nowEls(E, [row({ model: 'claude-opus-5-6' })], T0, surface))
    expect(now).toContain('opus-5-6')
    expect(now).toContain('$6.10')
    expect(now).not.toContain('≈')
  }
  expect(nowCells(row({ model: 'claude-opus-5-6' }), T0).join('')).not.toContain('≈')
})

test('the Week model table shows ≈ after the name of an estimated row on both surfaces, also when the name is cut, and keeps its widths', async () => {
  const week: WeekData = {
    ...WEEK,
    byModelScope: [
      { name: 'fable-5-1 main', cost: 331.52 },
      { name: 'opus-5-6 main', cost: 100, isEstimated: true },
      { name: 'sonnet-6[1m] general-purpose', cost: 50, isEstimated: true },
      { name: 'unknown-model main', cost: 0, isUnpriced: true },
    ],
    total: 849,
  }
  for (const surface of SURFACES) {
    const [, repos, models] = tablesOf(weekEls(E, week, undefined, surface))
    const name = (r: Node) => flat((r.props.children as Node[])[0])
    const rows = tableRows(models)
    expect(rows.map(name), surface).toEqual(['by model and scope'.padEnd(26), 'fable-5-1 main'.padEnd(26), 'opus-5-6 main ≈'.padEnd(26), 'sonnet-6[1m] general-p… ≈'.padEnd(26), 'unknown-model main'.padEnd(26)])
    for (const r of rows) expect(widthsOf(r), surface).toEqual([26, 21, 10, 6])
    expect(flat((rows[2].props.children as Node[])[2]), surface).toBe('$100.00'.padStart(10))
    expect(flat((rows[2].props.children as Node[])[3]), surface).toBe('12%'.padStart(6))
    // The cut name and its mark fit the 26 cells of the column with the free cell
    expect(Array.from('sonnet-6[1m] general-p… ≈')).toHaveLength(25)
    // The repo table has no mark
    expect(flat(repos)).not.toContain('≈')
    if (surface === 'terminal') for (const r of rows) expect(Array.from(flat(r))).toHaveLength(63)
  }
  const exact = flat(weekEls(E, { ...WEEK, byModelScope: [{ name: 'opus-5-5 main', cost: 100 }, { name: 'haiku-4-5 main', cost: 5 }], total: 105 }))
  expect(exact).not.toContain('≈')
})

test('the band shows ≈ before the re-warm cost of a fallback price, and not for an exact price or a model without a price', async () => {
  const at = (model: string, now: number, isWorking: boolean = false) => {
    const main = { ...mainAfter(NO_MAIN, model, T0, 411_002, 'start', 0.2, '1h', '1h'), isWorking }
    const totals = addTo({}, model, 'main', countsOf({ ...FABLE, model }, 3.11))
    return bandData(main, totals, [], null, now)!
  }
  for (const surface of SURFACES) {
    const hot = (model: string) => afterTube(bandEls(E, at(model, T0 + 13 * MIN), surface), surface)
    // 411,002 tokens at the 1-hour write price of claude-opus-5-5 (8 USD per million tokens)
    expect(hot('claude-opus-5-6'), surface).toMatch(/^HOT 47m left · 411k cached · ≈ \$3\.29 to re-warm \| /)
    expect(hot('claude-opus-4-9'), surface).toContain('· ≈ $3.29 to re-warm')
    expect(hot('claude-opus-5-5'), surface).toMatch(/^HOT 47m left · 411k cached · \$3\.29 to re-warm \| /)
    expect(hot('claude-opus-5-5[1m]'), surface).not.toContain('≈')
    expect(hot('claude-mythos-1'), surface).not.toContain('re-warm')
    expect(hot('claude-mythos-1'), surface).not.toContain('≈')
  }
  expect(at('claude-opus-5-6', T0 + 13 * MIN).label).toBe('47m left · 411k cached · ≈ $3.29 to re-warm')
  expect(at('claude-opus-5-5', T0 + 13 * MIN).label).toBe('47m left · 411k cached · $3.29 to re-warm')
  // The COLD label has its own ≈ and does not get a second one
  expect(at('claude-opus-5-6', T0 + 75 * MIN).label).toBe('15m · next message re-writes 411k ≈ $3.29')
  expect(at('claude-opus-5-5', T0 + 75 * MIN).label).toBe('15m · next message re-writes 411k ≈ $3.29')
  expect(at('claude-opus-5-6', T0 + 75 * MIN).label).not.toContain('≈ ≈')
  // A live turn shows no re-warm cost, so no mark
  expect(at('claude-opus-5-6', T0 + 13 * MIN, true).label).toBe('in turn · 411k cached')
})

test('a row without a model shows an empty model cell, not unknown', async () => {
  expect(nowCells(row({ model: '' }), T0)[2]).toBe('')
  expect(nowCells(row({}), T0)[2]).toBe('fable-5-1')
  const tree = nowEls(E, [row({ model: '', isCurrent: true })], T0)
  const line = flat(tree).split('\n')[1]
  expect(line).not.toContain('unknown')
  expect(Array.from(line)).toHaveLength(80)
})

test('on the desktop the band draws one Svg for the tube, then the stage word and the label as Text', async () => {
  const { main, totals } = oneRequest()
  const data = bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!
  const tree = bandEls(E, data, 'desktop')
  const svgs = all(tree, 'Svg')
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.alt).toBe('cache 78% left')
  expect(svgs[0].props.alt).toBe(tubeAlt(1 - 13 / 60))
  expect(svgs[0].props.source).toContain('viewBox="0 0 90 14"')
  expect(svgs[0].props.source).toBe(barSvg(1 - 13 / 60, 10))
  expect(svgs[0].props.width).toBe(90)
  expect(svgs[0].props.height).toBe(14)
  const text = flat(tree)
  const shrink = all(tree, 'Box').find((b) => b.props.flexShrink === 1)
  expect((shrink.props.children as Node[]).map((c) => [c.type, c.props.wrap])).toEqual([['Text', 'truncate-end']])
  expect(all(tree, 'Box').find((b) => b.props.flexShrink === 0)).toBeDefined()
  expect(text).toBe(' HOT 47m left · 411k cached · $8.22 to re-warm | week 41% · 5h 12% | fable-5-1 r400k w10.0k o1.0k')
  for (const ch of [BULB, '█', '░', '▕', '▏']) expect(text).not.toContain(ch)
  const stage = all(tree, 'Text').find((t) => flat(t) === 'HOT')
  expect(stage?.props.color).toBe(heatText(1 - 13 / 60))
  expect(stage?.props.bold).toBe(true)
})

test('on the terminal the band draws no Svg and keeps the text cells', async () => {
  const { main, totals } = oneRequest()
  const data = bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!
  for (const tree of [bandEls(E, data), bandEls(E, data, 'terminal')]) {
    expect(all(tree, 'Svg')).toHaveLength(0)
    expect(flat(tree).startsWith('▕')).toBe(true)
    expect(flat(tree)).not.toContain(BULB)
    expect((tree as Node).type).toBe('Text')
  }
})

test('on the desktop the band without a tube draws no Svg, and a surface without Svg keeps the text cells', async () => {
  expect(all(bandEls(E, bandData(NO_MAIN, {}, LIMITS, T0, T0)!, 'desktop'), 'Svg')).toHaveLength(0)
  const { main, totals } = oneRequest()
  const tree = bandEls(NO_SVG, bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!, 'desktop')
  expect(flat(tree).startsWith('▕')).toBe(true)
  expect(flat(tree)).not.toContain(BULB)
})

test('the cache column of the Now table has four boxes of fixed width on both surfaces', async () => {
  const rows = [row({ isCurrent: true }), row({ key: 'run:b:1', lastMainRequestAt: T0 - 31 * MIN })]
  for (const surface of ['terminal', 'desktop']) {
    const tree = nowEls(E, rows, T0, surface)
    const rowsBoxes = ((tree as Node).props.children as Node[]).filter((n) => n.props.flexDirection === 'row')
    const cache = (rowsBoxes[2].props.children as Node[])[0]
    const boxes = cache.props.children as Node[]
    expect(boxes.map((b) => b.props.width)).toEqual([8, 8, 5, 1])
    expect(boxes.every((b) => b.props.flexShrink === 0)).toBe(true)
    expect(boxes[2].props.justifyContent).toBe('flex-end')
    expect(flat(boxes[1]).trim()).toBe('WARM')
    expect(all(boxes[1], 'Text')[0].props).toMatchObject({ bold: true, color: heatText(1 - 31 / 60) })
    expect(flat(boxes[2]).trim()).toBe('29m')
    // The Svg has no text, so only the terminal row has a text width
    if (surface === 'terminal') {
      expect(Array.from(flat(cache))).toHaveLength(22)
      for (const r of rowsBoxes) expect(Array.from(flat(r)).length).toBe(80)
    }
    if (surface === 'desktop') {
      expect(all(boxes[0], 'Svg')).toHaveLength(1)
      // No width and height: the tube scales to its 8-cell box
      expect(all(boxes[0], 'Svg')[0].props.width).toBeUndefined()
      expect(all(boxes[0], 'Svg')[0].props.height).toBeUndefined()
      expect(all(boxes[0], 'Svg')[0].props.source).toContain('viewBox="0 0 72 14"')
      expect(all(boxes[0], 'Text')).toHaveLength(0)
      expect(all(tree, 'Svg')).toHaveLength(2)
    } else {
      expect(all(tree, 'Svg')).toHaveLength(0)
      expect(flat(boxes[0])).toBe(tubeCells(1 - 31 / 60, 8).map((c) => c.char).join(''))
    }
  }
})

test('the Now table drops ctx, model, today and 60 min in this order, and keeps cache and repo', async () => {
  const rows = [row({ isCurrent: true })]
  const header = (available?: number) => {
    const tree = nowEls(E, rows, T0, 'terminal', available)
    const first = ((tree as Node).props.children as Node[])[0]
    return { widths: (first.props.children as Node[]).map((c) => c.props.width), text: flat(first), body: flat(((tree as Node).props.children as Node[])[1]) }
  }
  expect(NOW_COLUMNS.reduce((sum, c) => sum + c.width, 0)).toBe(80)
  expect(header(undefined).widths).toEqual([22, 21, 11, 6, 10, 10])
  expect(header(80).widths).toEqual([22, 21, 11, 6, 10, 10])
  expect(header(79).widths).toEqual([22, 21, 11, 10, 10])
  expect(header(74).widths).toEqual([22, 21, 11, 10, 10])
  const narrow = header(63)
  expect(narrow.widths).toEqual([22, 21, 10, 10])
  expect(narrow.text).toContain('cache')
  expect(narrow.text).toContain('repo')
  expect(narrow.text).toContain('60 min')
  expect(narrow.text).toContain('today')
  expect(narrow.text).not.toContain('model')
  expect(narrow.text).not.toContain('ctx')
  expect(narrow.body).toContain('webshop')
  expect(narrow.body).not.toContain('fable-5-1')
  expect(narrow.body).not.toContain('412k')
  expect(header(62).widths).toEqual([22, 21, 10])
  expect(header(53).widths).toEqual([22, 21, 10])
  expect(header(52).widths).toEqual([22, 21])
  expect(header(43).widths).toEqual([22, 21])
  expect(header(10).widths).toEqual([22, 21])
})

test('the current row keeps its background and bold texts when columns drop, on both surfaces', async () => {
  for (const surface of SURFACES) {
    for (const available of [undefined, 63, 52, 10]) {
      const where = surface + ' at ' + (available ?? 'full width')
      const [head, current, other] = kids(nowEls(E, [row({ isCurrent: true }), row({ key: 'run:b:1' })], T0, surface, available) as Node)
      expect(current.props.backgroundColor, where).toBe('selectionBg')
      expect([head.props.backgroundColor, other.props.backgroundColor], where).toEqual([undefined, undefined])
      expect(all(kids(current)[1], 'Text')[0].props.bold, where).toBe(true)
      expect(flat(kids(current)[1]).trim(), where).toBe('webshop')
    }
  }
})

test('the Session table drops input, req, c.write, output and share in this order', async () => {
  const d = {
    rows: [{ model: 'claude-fable-5-1', scope: 'main', counts: { ...EMPTY, requests: 1, cost: 1 } }],
    total: { ...EMPTY, requests: 1, cost: 1 },
    causes: NO_CAUSES,
    requests: reqs([]),
    resumes: [],
    now: T0,
    usd: null,
  }
  const widths = (available?: number) => {
    const table = all(sessionEls(E, d, available), 'Box').find((b) => b.props.flexDirection === 'column' && (b.props.children as Node[]).every((c) => c.props.flexDirection === 'row'))!
    return ((table.props.children as Node[])[0].props.children as Node[]).map((c) => c.props.width)
  }
  expect(widths()).toEqual([11, 16, 5, 7, 9, 7, 8, 10, 7])
  expect(widths(73)).toEqual([11, 16, 5, 9, 7, 8, 10, 7])
  expect(widths(68)).toEqual([11, 16, 9, 7, 8, 10, 7])
  expect(widths(59)).toEqual([11, 16, 7, 8, 10, 7])
  expect(widths(51)).toEqual([11, 16, 7, 10, 7])
  expect(widths(43)).toEqual([11, 16, 7, 10])
  expect(widths(20)).toEqual([11, 16, 7, 10])
})

test('cellTexts draws one Text for each tube cell and dims the empty cells', async () => {
  const texts = cellTexts(E, tubeCells(0.5, 4)) as Node[]
  expect(texts.map((t) => flat(t))).toEqual(['█', '█', '░', '░'])
  expect(texts[0].props).toEqual({ color: heat(0.125), children: ['█'] })
  expect(texts[2].props).toEqual({ dimColor: true, children: ['░'] })
})

test('svgBox is a Box of the width of the cells with one Svg and no shrink', async () => {
  const box = svgBox(E, '<svg/>', 'alt text', 20) as Node
  expect(box.type).toBe('Box')
  expect(box.props.width).toBe(20)
  expect(box.props.flexShrink).toBe(0)
  const svgs = all(box, 'Svg')
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props).toEqual({ source: '<svg/>', alt: 'alt text' })
})

test('barEls on the desktop is one Box with the width of the bar and one Svg without a width', async () => {
  const parts = barEls(E, 0.41, 20, 21, 'share 41%', 'desktop') as Node[]
  expect(parts).toHaveLength(1)
  expect(parts[0].type).toBe('Box')
  expect(parts[0].props.width).toBe(20)
  expect(parts[0].props.flexShrink).toBe(0)
  const svgs = all(parts, 'Svg')
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.width).toBeUndefined()
  expect(svgs[0].props.height).toBeUndefined()
  expect(svgs[0].props.alt).toBe('share 41%')
  expect(svgs[0].props.source).toBe(barSvg(0.41, 20))
  expect(all(parts, 'Text')).toHaveLength(0)
})

test('barEls on the terminal has no Svg, the text of the column width and dimmed empty cells', async () => {
  for (const tree of [barEls(E, 0.41, 20, 21, 'share 41%'), barEls(E, 0.41, 20, 21, 'share 41%', 'terminal')]) {
    expect(all(tree, 'Svg')).toHaveLength(0)
    expect(Array.from(flat(tree))).toHaveLength(21)
    // 0.41 of 20 cells is 8 full cells and one eighth
    expect(flat(tree)).toBe('█'.repeat(8) + '▏' + '░'.repeat(11) + ' ')
    const texts = all(tree, 'Text')
    expect(texts.filter((t) => flat(t) === '░').every((t) => t.props.dimColor === true)).toBe(true)
    expect(texts.filter((t) => flat(t) === '█').every((t) => typeof t.props.color === 'string' && t.props.dimColor === undefined)).toBe(true)
    expect(texts[0].props.color).toBe(heat(0.5 / 20))
    expect(texts[8].props.color).toBe(heat(8.5 / 20))
  }
})

test('barEls on the terminal adds no spacer when the bar fills its column, and a cut-off surface keeps the text cells', async () => {
  expect(barEls(E, 1, 20, 20, 'share 100%')).toHaveLength(20)
  expect(barEls(E, 1, 20, 21, 'share 100%')).toHaveLength(21)
  expect(flat(barEls(E, 0, 20, 20, 'share 0%'))).toBe('░'.repeat(20))
  const tree = barEls(NO_SVG, 0.5, 20, 21, 'share 50%', 'desktop')
  expect(all(tree, 'Svg')).toHaveLength(0)
  expect(Array.from(flat(tree))).toHaveLength(21)
})

test('stripEls on the desktop is one Box with one Svg of the strip', async () => {
  const cells = [{ char: ' ', color: '' }, { char: '░', color: heat(0) }, { char: '█', color: heat(0.5) }]
  const parts = stripEls(E, cells, 4, 'cache history', 'desktop') as Node[]
  expect(parts).toHaveLength(1)
  expect(parts[0].props.width).toBe(3)
  expect(parts[0].props.flexShrink).toBe(0)
  const svgs = all(parts, 'Svg')
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.width).toBeUndefined()
  expect(svgs[0].props.source).toBe(stripSvg(cells))
  expect(svgs[0].props.alt).toBe('cache history')
})

test('stripEls on the terminal draws warm cells in colour, cold cells dimmed and a space for no data', async () => {
  const cells = [{ char: ' ', color: '' }, { char: '░', color: heat(0) }, { char: '█', color: heat(0.5) }]
  const tree = stripEls(E, cells, 5, 'cache history')
  expect(all(tree, 'Svg')).toHaveLength(0)
  expect(flat(tree)).toBe(' ░█  ')
  const texts = all(tree, 'Text')
  expect(texts[0].props.color).toBeUndefined()
  expect(texts[1].props).toEqual({ dimColor: true, children: ['░'] })
  expect(texts[2].props).toEqual({ color: heat(0.5), children: ['█'] })
})

test('sparkEls on the desktop is one Box with one Svg of the columns', async () => {
  const cells = [{ char: '▃', percent: 41, isFuture: false }, PAST_EMPTY, FUTURE]
  const parts = sparkEls(E, cells, 21, 'week history', 'desktop') as Node[]
  expect(parts).toHaveLength(1)
  expect(parts[0].props.width).toBe(3)
  expect(parts[0].props.flexShrink).toBe(0)
  const svgs = all(parts, 'Svg')
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.width).toBeUndefined()
  expect(svgs[0].props.source).toBe(sparkSvg(cells))
  expect(svgs[0].props.alt).toBe('week history')
})

test('on the desktop the history Svg box is 14 cells wide, for a week with one reading and for a week with none', async () => {
  const start = Date.UTC(2026, 9, 4, 11, 0)
  const now = Date.UTC(2026, 9, 6, 18, 0)
  const one = historyCells([{ at: now - 60 * MIN, kind: 'seven_day', percentUsed: 41 }], start, now)
  const parts = sparkEls(E, one, 21, 'week history', 'desktop') as Node[]
  expect(parts).toHaveLength(1)
  expect(parts[0].props.width).toBe(14)
  expect(parts[0].props.flexShrink).toBe(0)
  expect(all(parts, 'Svg')[0].props.source).toContain('width="126" height="14" viewBox="0 0 126 14"')
  const none = sparkEls(E, historyCells([], start, now), 21, 'week history', 'desktop') as Node[]
  expect(none[0].props.width).toBe(14)
  // In the Week tab the history sits in the same box
  const box = all(weekEls(E, { ...WEEK, history: one }, undefined, 'desktop'), 'Box').find((b) => (b.props.children as Node[]).some((c) => c.type === 'Svg' && c.props.alt.startsWith('week history')))
  expect([box?.props.width, box?.props.flexShrink]).toEqual([14, 0])
})

test('sparkEls on the terminal draws the history char in the heat colour, a dimmed empty cell for a past period and a dimmed dot for a future one', async () => {
  const cells = [{ char: '▃', percent: 41, isFuture: false }, PAST_EMPTY, FUTURE, { char: '█', percent: 100, isFuture: false }]
  const tree = sparkEls(E, cells, 6, 'week history')
  expect(all(tree, 'Svg')).toHaveLength(0)
  expect(flat(tree)).toBe('▃░·█  ')
  const texts = all(tree, 'Text')
  expect(texts[0].props).toEqual({ color: heat(0.41), children: ['▃'] })
  expect(texts[1].props).toEqual({ dimColor: true, children: ['░'] })
  expect(texts[2].props).toEqual({ dimColor: true, children: ['·'] })
  expect(texts[3].props).toEqual({ color: heat(1), children: ['█'] })
  expect(Array.from(flat(sparkEls(E, Array(14).fill(PAST_EMPTY), 21, 'week history')))).toHaveLength(21)
})

// The style props of the Text in one string cell of a table
function styleOf(tree: unknown, ri: number, ci: number): Record<string, unknown> {
  const rowBox = ((tree as Node).props.children as Node[])[ri]
  const columnBox = (rowBox.props.children as Node[])[ci]
  const { children: _children, ...style } = (columnBox.props.children as Node[])[0].props
  return style
}

const TWO_COLUMNS = [{ width: 4, align: 'left' as const }, { width: 4, align: 'right' as const }]
const FOUR_ROWS = [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]

test('tableEls dims the string cells of dimRows and of dimColumns, and nothing without the options', async () => {
  const plain = tableEls(E, TWO_COLUMNS, FOUR_ROWS)
  for (let ri = 0; ri < 4; ri++) for (let ci = 0; ci < 2; ci++) expect(styleOf(plain, ri, ci)).toEqual({})
  const rows = tableEls(E, TWO_COLUMNS, FOUR_ROWS, { dimRows: [1, 3] })
  for (let ci = 0; ci < 2; ci++) expect([0, 1, 2, 3].map((ri) => styleOf(rows, ri, ci))).toEqual([{}, { dimColor: true }, {}, { dimColor: true }])
  const columns = tableEls(E, TWO_COLUMNS, FOUR_ROWS, { dimColumns: [0] })
  for (let ri = 0; ri < 4; ri++) expect([styleOf(columns, ri, 0), styleOf(columns, ri, 1)]).toEqual([{ dimColor: true }, {}])
})

test('tableEls styles a string cell by header row, dim row, bold row and dim column, in this order', async () => {
  const tree = tableEls(E, TWO_COLUMNS, FOUR_ROWS, { headerRows: 1, dimRows: [0, 1], boldRows: [1, 2], dimColumns: [0] })
  expect([styleOf(tree, 0, 0), styleOf(tree, 0, 1)]).toEqual([{ dimColor: true }, { dimColor: true }])
  // A dim row wins over a bold row
  expect([styleOf(tree, 1, 0), styleOf(tree, 1, 1)]).toEqual([{ dimColor: true }, { dimColor: true }])
  // A bold row wins over a dim column
  expect([styleOf(tree, 2, 0), styleOf(tree, 2, 1)]).toEqual([{ bold: true }, { bold: true }])
  expect([styleOf(tree, 3, 0), styleOf(tree, 3, 1)]).toEqual([{ dimColor: true }, {}])
})

test('tableEls keeps the own style of an element cell in a dim row and a dim column', async () => {
  const columns = [{ width: 4, align: 'left' as const }, { width: 4, align: 'left' as const }]
  const own = E.Text({ bold: true, color: '#e24b4a', children: ['x'] })
  const tree = tableEls(E, columns, [[[own], [own]]], { dimRows: [0], dimColumns: [0, 1] }) as Node
  const cells = ((tree.props.children as Node[])[0].props.children as Node[]).map((c) => (c.props.children as Node[])[0])
  expect(cells).toEqual([own, own])
  expect(cells[0].props).toEqual({ bold: true, color: '#e24b4a', children: ['x'] })
})

test('tableEls takes the dim column by the index of the column, also when columns drop', async () => {
  const columns = [{ width: 6, align: 'left' as const }, { width: 6, align: 'left' as const }, { width: 6, align: 'left' as const }]
  const tree = tableEls(E, columns, [['a', 'b', 'c']], { dimColumns: [2], dropOrder: [1], available: 12 }) as Node
  const row = (tree.props.children as Node[])[0].props.children as Node[]
  expect(row.map((c) => c.props.width)).toEqual([6, 6])
  expect(row.map((c) => (c.props.children as Node[])[0].props.dimColor)).toEqual([undefined, true])
})

// The cross-tab alignment check. A table is a column Box whose children are all row Boxes. Each row is a list of column Boxes.
const ALL_BAR_CHARS = [...BAR_CHARS, ...SPARK_CHARS]

const kids = (n: Node): Node[] => (n.props.children ?? []) as Node[]

// Every Svg of a tree with the element that holds it
function svgHolders(node: unknown, holder: Node | null = null): [Node, Node | null][] {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap((c) => svgHolders(c, holder))
  const n = node as Node
  return [...(n.type === 'Svg' ? [[n, holder] as [Node, Node | null]] : []), ...svgHolders(kids(n), n)]
}

// Checks the tree of one pane tab on one surface and returns what it looked at: the column widths of each table and the count of Svg.
// 'desktop' means a surface with Svg. A surface without Svg draws text cells and is checked as 'terminal'.
function checkAligned(tree: unknown, surface: 'terminal' | 'desktop', where = 'tree'): { tables: number[][]; svgs: number } {
  const tables = all(tree, 'Box').filter((b) => b.props.flexDirection === 'column' && kids(b).length > 0 && kids(b).every((r) => r.type === 'Box' && r.props.flexDirection === 'row'))
  const found: number[][] = []
  for (const [ti, table] of tables.entries()) {
    const rows = kids(table)
    const first = kids(rows[0]!).map((c) => c.props.width)
    for (const [ri, r] of rows.entries()) {
      const at = where + ': table ' + ti + ', row ' + ri
      const columns = kids(r)
      expect(columns.length, at + ' has columns').toBeGreaterThan(0)
      for (const [ci, c] of columns.entries()) {
        expect(c.type, at + ', column ' + ci + ' is a Box').toBe('Box')
        expect(typeof c.props.width, at + ', column ' + ci + ' has a width').toBe('number')
        expect(c.props.flexShrink, at + ', column ' + ci + ' does not shrink').toBe(0)
      }
      expect(columns.map((c) => c.props.width), at + ' has the widths of the first row').toEqual(first)
      if (surface === 'terminal') {
        // Each column holds exactly its width in characters, so that the next column starts at its place
        expect(Array.from(flat(r)).length, at + ' has the sum of its widths').toBe(first.reduce((sum, w) => sum + w, 0))
        for (const [ci, c] of columns.entries()) expect(Array.from(flat(c)).length, at + ', column ' + ci + ' has its width').toBe(c.props.width)
      }
    }
    found.push(first)
  }
  const holders = svgHolders(tree)
  if (surface === 'terminal') {
    expect(holders.length, where + ' has no Svg').toBe(0)
  } else {
    for (const t of all(tree, 'Text')) {
      expect(ALL_BAR_CHARS.filter((ch) => flat(t).includes(ch)), where + ': a Text has a bar character: ' + flat(t)).toEqual([])
    }
    const columns = tables.flatMap((t) => kids(t).flatMap(kids))
    for (const [svg, holder] of holders) {
      expect(holder?.type, where + ': an Svg sits in a Box').toBe('Box')
      // The box of an Svg is its own box, not the column: the Svg scales to the width of its cells
      expect(columns.includes(holder!), where + ': an Svg does not sit directly in a column').toBe(false)
      expect(typeof holder?.props.width, where + ': the box of an Svg has a width').toBe('number')
      expect(holder?.props.flexShrink, where + ': the box of an Svg does not shrink').toBe(0)
      expect(svg.props.width, where + ': an Svg has no width').toBeUndefined()
      expect(svg.props.height, where + ': an Svg has no height').toBeUndefined()
    }
  }
  return { tables: found, svgs: holders.length }
}

// Realistic data: requests of every stage, an unpriced model, models with a fallback price (a name that fits with the mark and a name that is cut), resumes, a history with empty and future cells, lists in Why, and names that are cut
const PANE_NOW: NowRow[] = [
  row({ isCurrent: true, isWorking: true }),
  row({ key: 'run:b:1', repo: 'billing-service', model: 'claude-opus-5-5', lastMainRequestAt: T0 - 31 * MIN }),
  row({ key: 'run:c:1', repo: 'data-pipeline-config', model: 'claude-opus-5-5', lastMainRequestAt: T0 - 75 * MIN }),
  row({ key: 'run:d:1', model: 'unknown-model', lastMainRequestAt: T0 - 5 * MIN }),
  row({ key: 'run:e:1', model: '', lastMainRequestAt: null }),
]

const PANE_SESSION: SessionData = {
  ...SESSION,
  rows: [...SESSION.rows, { model: 'unknown-model', scope: 'main', counts: { ...EMPTY, requests: 3, input: 90, cacheRead: 40_000, cost: 0 } }, ...ESTIMATED_ROWS],
  requests: reqs([T0 - 220 * MIN, T0 - 150 * MIN, T0 - 100 * MIN, T0 - 30 * MIN, T0 - 3 * MIN]),
  // Nine resumes 5 cells apart: no label has room, and the list of the costs cuts the oldest ones
  resumes: Array.from({ length: 9 }, (_, i) => ({ at: T0 - (230 - i * 25) * MIN, cost: 3.5 + i * 11 })),
}

const PANE_WEEK: WeekData = {
  ...WEEK,
  history: Array.from({ length: 14 }, (_, i): HistoryCell => {
    if (i === 3 || i === 4) return PAST_EMPTY
    if (i >= 11) return FUTURE
    return { char: '▁▂▃▄▅▆▇█'.charAt(Math.floor(((5 + i * 7) / 100) * 8)), percent: 5 + i * 7, isFuture: false }
  }),
  byRepo: [...WEEK.byRepo, { name: 'data-pipeline-config-and-integration', cost: 61 }, { name: 'report-exporter', cost: 3 }],
  byModelScope: [...WEEK.byModelScope, { name: 'opus-5-6 main', cost: 100, isEstimated: true }, { name: 'sonnet-6[1m] general-purpose', cost: 50, isEstimated: true }],
}

const PANE_WHY: Breakdown = {
  total: 412_000,
  max: 1_000_000,
  categories: [{ name: 'Messages', tokens: 318_000 }, { name: 'System prompt', tokens: 6000 }, { name: 'System tools', tokens: 17_500 }, { name: 'Custom agents and a long name', tokens: 800 }],
  memoryFiles: [{ name: 'webshop/CLAUDE.md', tokens: 9800 }, { name: '/Users/me/repos/webshop/.claude/rules/a-long-memory-file-name/CLAUDE.md', tokens: 3100 }],
  mcpServers: [{ name: 'linear', tokens: 11_200 }, { name: 'a-server-with-a-very-long-name-for-a-narrow-pane', tokens: 300 }],
  agents: [{ name: 'reviewer', tokens: 800 }, { name: 'general-purpose', tokens: 0 }],
}

type PaneCase = { name: string; tables: number; svgs: number; draw: (els: Els, available: number | undefined, surface: string) => unknown }

// svgs: the Svg of the desktop at the full width. The Now tab has no Svg for the row without a request
const PANE_CASES: PaneCase[] = [
  { name: 'Now', tables: 1, svgs: 4, draw: (els, available, surface) => nowEls(els, PANE_NOW, T0, surface, available) },
  { name: 'Session', tables: 3, svgs: 4, draw: (els, available, surface) => sessionEls(els, PANE_SESSION, available, surface) },
  { name: 'Session without resumes, causes and the reported row', tables: 3, svgs: 4, draw: (els, available, surface) => sessionEls(els, { ...PANE_SESSION, causes: NO_CAUSES, requests: reqs([]), resumes: [], usd: null }, available, surface) },
  { name: 'Week', tables: 3, svgs: 10, draw: (els, available, surface) => weekEls(els, PANE_WEEK, available, surface) },
  { name: 'Week without a limit', tables: 3, svgs: 0, draw: (els, available, surface) => weekEls(els, { percent: null, resetAt: null, projection: '', start: SUNDAY_START, history: [], byRepo: [], byModelScope: [], total: 0 }, available, surface) },
  { name: 'Why', tables: 5, svgs: 5, draw: (els, available, surface) => whyEls(els, PANE_WHY, available, surface) },
  { name: 'Why without a total', tables: 2, svgs: 1, draw: (els, available, surface) => whyEls(els, { total: 0, max: 0, categories: [], memoryFiles: [], mcpServers: [], agents: [] }, available, surface) },
]

// Draws every case on every surface at each width and checks it. The width undefined is the full width.
function checkPaneCases(widths: (number | undefined)[]) {
  for (const c of PANE_CASES) {
    for (const available of widths) {
      const where = c.name + ' at ' + (available ?? 'full width')
      const terminal = checkAligned(c.draw(E, available, 'terminal'), 'terminal', where + ' on the terminal')
      const desktop = checkAligned(c.draw(E, available, 'desktop'), 'desktop', where + ' on the desktop')
      // A surface without Svg draws the same table as the terminal
      const cutOff = checkAligned(c.draw(NO_SVG, available, 'desktop'), 'terminal', where + ' without Svg')
      expect(terminal.tables.length, where).toBe(c.tables)
      // The surface changes the cells of a column, never the columns
      expect(desktop.tables, where).toEqual(terminal.tables)
      expect(cutOff.tables, where).toEqual(terminal.tables)
      if (available === undefined || available >= 80) expect(desktop.svgs, where).toBe(c.svgs)
    }
  }
}

test('every table of the four tabs has the same widths in every row and fixed column boxes on both surfaces, at the full width', async () => {
  checkPaneCases([undefined, 80])
})

test('every table of the four tabs has the same widths in every row and fixed column boxes on both surfaces, at a narrow width', async () => {
  checkPaneCases([62, 45])
})

test('at 62 columns every table of the four tabs fits its room', async () => {
  for (const c of PANE_CASES) {
    for (const surface of SURFACES) {
      for (const widths of checkAligned(c.draw(E, 62, surface), surface === 'desktop' ? 'desktop' : 'terminal', c.name).tables) {
        expect(widths.reduce((sum, w) => sum + w, 0), c.name + ' on the ' + surface).toBeLessThanOrEqual(62)
      }
    }
  }
})

test('the day axis keeps the columns of the head grid at 80, 62 and 45 columns on both surfaces, and the history row keeps its place', async () => {
  const week = PANE_CASES.find((c) => c.name === 'Week')!
  for (const available of [undefined, 80, 62, 45]) {
    for (const surface of SURFACES) {
      const where = 'at ' + (available ?? 'full width') + ' on the ' + surface
      const tree = week.draw(E, available, surface)
      checkAligned(tree, surface === 'desktop' ? 'desktop' : 'terminal', where)
      const rows = tableRows(tablesOf(tree)[0])
      // The week, the reset, the projection, the history and the axis. Only the empty cost column drops, so every row keeps its widths
      expect(rows, where).toHaveLength(5)
      const widths = widthsOf(rows[0])
      expect(widths.slice(0, 2), where).toEqual([26, 21])
      for (const r of rows) expect(widthsOf(r), where).toEqual(widths)
      const meter = columnsOf(rows[4])[1]
      if (surface === 'desktop') {
        expect((meter.props.children as Node[]).map((b) => b.props.width), where).toEqual(Array(7).fill(2))
      } else {
        // The names start at the meter column, as the cells of the history do
        expect(flat(rows[4]).slice(26, 26 + 14), where).toBe('S M T W T F S ')
        expect(Array.from(flat(rows[3])).slice(26, 26 + 14).join(''), where).toBe(flat(columnsOf(rows[3])[1]).slice(0, 14))
      }
    }
  }
})

test('the Session note shows at every width on both surfaces and only with the reported row, and the tables stay aligned', async () => {
  const withRow = PANE_CASES.find((c) => c.name === 'Session')!
  const withoutRow = PANE_CASES.find((c) => c.name === 'Session without resumes, causes and the reported row')!
  for (const available of [undefined, 80, 62, 45]) {
    for (const surface of SURFACES) {
      const where = 'at ' + (available ?? 'full width') + ' on the ' + surface
      const tree = withRow.draw(E, available, surface)
      expect(all(tree, 'Text').filter((t) => flat(t) === SESSION_NOTE), where).toHaveLength(1)
      expect(checkAligned(tree, surface === 'desktop' ? 'desktop' : 'terminal', where).tables, where).toHaveLength(3)
      // The reported row keeps the widths of the other rows, also when columns drop
      const main = tablesOf(tree)[0]
      expect(flat(main).includes('reported'), where).toBe(true)
      const none = withoutRow.draw(E, available, surface)
      expect(all(none, 'Text').filter((t) => flat(t).includes('estimate:')), where).toEqual([])
      expect(flat(tablesOf(none)[0]).includes('reported'), where).toBe(false)
    }
  }
})

test('the current row of the Now table has the selection background on its row Box and bold texts, on both surfaces', async () => {
  const rows = [row({ isCurrent: true, isWorking: true }), row({ key: 'run:b:1', lastMainRequestAt: T0 - 31 * MIN }), row({ key: 'run:c:1', model: '', lastMainRequestAt: null })]
  for (const surface of SURFACES) {
    const tree = nowEls(E, rows, T0, surface)
    const [head, current, ...others] = kids(tree as Node)
    // The row Box has the background, and no Text has one: the Box also covers the Svg and the gaps between the columns
    expect(current.props.backgroundColor, surface).toBe('selectionBg')
    expect(all(tree, 'Text').filter((t) => t.props.backgroundColor !== undefined), surface).toEqual([])
    // The header and the other rows have no background
    for (const r of [head, ...others]) expect(r.props.backgroundColor, surface).toBeUndefined()
    // The texts of repo, model, ctx, 60 min and today are bold
    const columns = kids(current)
    for (const ci of [1, 2, 3, 4, 5]) {
      const texts = all(columns[ci], 'Text')
      expect(texts, surface + ' column ' + ci).toHaveLength(1)
      expect(texts[0].props.bold, surface + ' column ' + ci).toBe(true)
    }
    expect(flat(columns[1]).trim()).toBe('webshop')
    expect(flat(columns[5]).trim()).toBe('$48.20')
    // The stage word keeps its text colour of heat and its bold
    const stage = all(columns[0], 'Text').find((t) => flat(t).trim() === 'LIVE')!
    expect(stage.props).toMatchObject({ bold: true, color: heatText(1) })
    // The string cells of the other rows are not bold
    for (const r of others) for (const ci of [1, 2, 3, 4, 5]) expect(all(kids(r)[ci], 'Text')[0].props.bold, surface).toBeUndefined()
  }
})

test('the Now table has no row with a background when no session is current', async () => {
  for (const surface of SURFACES) {
    const tree = nowEls(E, [row({ key: 'run:b:1' }), row({ key: 'run:c:1', lastMainRequestAt: T0 - 31 * MIN })], T0, surface)
    expect(JSON.stringify(tree), surface).not.toContain('backgroundColor')
    expect(JSON.stringify(tree), surface).not.toContain('selectionBg')
  }
})

test('a current row without a request has the background and keeps the 80 cells of its text form', async () => {
  const r = row({ isCurrent: true, model: '', lastMainRequestAt: null })
  for (const surface of SURFACES) {
    const [current] = kids(nowEls(E, [r], T0, surface) as Node).slice(1)
    expect(current.props.backgroundColor, surface).toBe('selectionBg')
    expect(flat(current), surface).toBe(line(nowCells(r, T0), NOW_COLUMNS))
    expect(Array.from(flat(current)), surface).toHaveLength(80)
  }
})

test('the Now tab draws no > in any Text, at any width, on both surfaces', async () => {
  for (const surface of SURFACES) {
    for (const available of [undefined, 80, 62, 45]) {
      for (const t of all(nowEls(E, PANE_NOW, T0, surface, available), 'Text')) expect(flat(t), surface + ' at ' + (available ?? 'full width')).not.toContain('>')
    }
  }
  for (const r of PANE_NOW) expect(nowCells(r, T0).some((c) => c.includes('>'))).toBe(false)
})

test('tableEls puts the selection background on the row Box of a selected row and bolds its string cells', async () => {
  const columns = [{ width: 4, align: 'left' as const }, { width: 4, align: 'right' as const }]
  const own = E.Text({ color: '#e24b4a', children: ['x'] })
  const tree = tableEls(E, columns, [['a', 'b'], ['c', 'd'], [[own], 'e']], { headerRows: 1, selectedRows: [1, 2] }) as Node
  const [head, one, two] = kids(tree)
  expect(head.props.backgroundColor).toBeUndefined()
  expect([one.props.backgroundColor, two.props.backgroundColor]).toEqual(['selectionBg', 'selectionBg'])
  expect(kids(head).map((c) => kids(c)[0].props.dimColor)).toEqual([true, true])
  expect(kids(head).map((c) => kids(c)[0].props.bold)).toEqual([undefined, undefined])
  expect(kids(one).map((c) => kids(c)[0].props.bold)).toEqual([true, true])
  // An element cell keeps its own style
  expect(kids(kids(two)[0])[0]).toBe(own)
  expect(kids(kids(two)[1])[0].props.bold).toBe(true)
  // Without the option no row has a background
  expect(JSON.stringify(tableEls(E, columns, [['a', 'b'], ['c', 'd']], { headerRows: 1 }))).not.toContain('backgroundColor')
})

test('neither the band nor any tab has a bulb or a circle, on either surface', async () => {
  const { main, totals } = oneRequest()
  const bands = [
    bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!,
    bandData(main, totals, LIMITS, T0, T0 + 75 * MIN)!,
    bandData({ ...main, isWorking: true }, totals, LIMITS, T0, T0 + 75 * MIN)!,
    bandData(NO_MAIN, {}, LIMITS, T0, T0)!,
  ]
  const trees: [string, unknown][] = []
  for (const [i, d] of bands.entries()) {
    for (const surface of SURFACES) trees.push(['band ' + i + ' on the ' + surface, bandEls(E, d, surface)])
    trees.push(['band ' + i + ' on a surface without Svg', bandEls(NO_SVG, d, 'desktop')])
  }
  for (const c of PANE_CASES) {
    for (const surface of SURFACES) trees.push([c.name + ' on the ' + surface, c.draw(E, undefined, surface)])
    trees.push([c.name + ' on a surface without Svg', c.draw(NO_SVG, undefined, 'desktop')])
  }
  for (const [where, tree] of trees) {
    // The dump holds the text of every Text and the source of every Svg
    const dump = JSON.stringify(tree)
    expect(dump.includes(BULB), where + ' has a bulb').toBe(false)
    expect(dump.includes('<circle'), where + ' has a circle').toBe(false)
  }
  // The dump does reach the source of an Svg
  expect(JSON.stringify(bandEls(E, bands[0], 'desktop'))).toContain('<svg')
  expect(JSON.stringify(PANE_CASES[0].draw(E, undefined, 'desktop'))).toContain('<svg')
})

const box = (props: Record<string, unknown>, children: unknown[] = []) => E.Box({ ...props, children })
const column = (width: number, children: unknown[], props: Record<string, unknown> = {}) => box({ width, flexShrink: 0, flexDirection: 'row', ...props }, children)
const rowOf = (...columns: unknown[]) => box({ flexDirection: 'row' }, columns)
const tableOf = (...rows: unknown[]) => box({ flexDirection: 'column' }, rows)
const words = (value: string) => E.Text({ children: [value] })
const sized = E.Svg!({ source: '<svg/>', alt: 'bar' })

test('the alignment check accepts a table that is aligned on each surface', async () => {
  const terminal = tableOf(rowOf(column(4, [words('ab  ')]), column(3, [words('c  ')])), rowOf(column(4, [words('abcd')]), column(3, [words('   ')])))
  expect(checkAligned(terminal, 'terminal')).toEqual({ tables: [[4, 3]], svgs: 0 })
  const desktop = tableOf(rowOf(column(4, [words('ab')]), column(3, [box({ width: 3, flexShrink: 0 }, [sized])])))
  expect(checkAligned(desktop, 'desktop')).toEqual({ tables: [[4, 3]], svgs: 1 })
  expect(checkAligned(words('No data'), 'terminal')).toEqual({ tables: [], svgs: 0 })
})

// The check fails, and for the reason that the test names: its message holds the reason
const fails = (tree: unknown, surface: 'terminal' | 'desktop', reason: string) => expect(() => checkAligned(tree, surface, 'tree'), reason).toThrow(reason)

test('the alignment check fails for a row with other widths, a column that shrinks or has no width, and a text of the wrong length', async () => {
  const cell = (width: number, value: string, props: Record<string, unknown> = {}) => column(width, [words(value.padEnd(width))], props)
  // The sums of both rows are the same: only the list of widths differs
  fails(tableOf(rowOf(cell(4, 'a'), cell(3, 'b')), rowOf(cell(5, 'a'), cell(2, 'b'))), 'terminal', 'has the widths of the first row')
  fails(tableOf(rowOf(cell(4, 'a'), cell(3, 'b')), rowOf(cell(4, 'a'))), 'desktop', 'has the widths of the first row')
  fails(tableOf(rowOf(cell(4, 'a'), cell(3, 'b', { flexShrink: 1 }))), 'terminal', 'does not shrink')
  fails(tableOf(rowOf(cell(4, 'a'), cell(3, 'b', { flexShrink: undefined }))), 'desktop', 'does not shrink')
  fails(tableOf(rowOf(cell(4, 'a'), cell(3, 'b', { width: undefined }))), 'desktop', ', column 1 has a width')
  // A text that is too long or too short for its column
  fails(tableOf(rowOf(cell(4, 'a'), column(3, [words('bcd ')]))), 'terminal', 'has the sum of its widths')
  fails(tableOf(rowOf(cell(4, 'a'), column(3, [words('b')]))), 'terminal', 'has the sum of its widths')
  // The row has its length, but each column is cut wrong: the second column starts at the wrong place
  fails(tableOf(rowOf(column(4, [words('abcde')]), column(3, [words('cd')]))), 'terminal', ', column 0 has its width')
  // The text of a column is not checked on the desktop, where an Svg has no text
  expect(() => checkAligned(tableOf(rowOf(column(4, [words('a')]), column(3, [words('b')]))), 'desktop')).not.toThrow()
})

test('the alignment check fails for a bar character in a Text, a sized Svg, and an Svg outside a Box with a width', async () => {
  const withSvg = (svg: unknown, holder: Record<string, unknown> = { width: 3, flexShrink: 0 }) => tableOf(rowOf(column(3, [box(holder, [svg])])))
  expect(() => checkAligned(withSvg(sized), 'desktop')).not.toThrow()
  for (const ch of ALL_BAR_CHARS) fails(tableOf(rowOf(column(3, [words(ch)]))), 'desktop', 'a Text has a bar character')
  // The same text is right on the terminal
  expect(() => checkAligned(tableOf(rowOf(column(3, [words('█░ ')]))), 'terminal')).not.toThrow()
  fails(withSvg(E.Svg!({ source: '<svg/>', alt: 'bar', width: 54 })), 'desktop', 'an Svg has no width')
  fails(withSvg(E.Svg!({ source: '<svg/>', alt: 'bar', height: 14 })), 'desktop', 'an Svg has no height')
  fails(withSvg(sized, { width: 3 }), 'desktop', 'the box of an Svg does not shrink')
  fails(withSvg(sized, { width: 3, flexShrink: 1 }), 'desktop', 'the box of an Svg does not shrink')
  fails(withSvg(sized, { flexShrink: 0 }), 'desktop', 'the box of an Svg has a width')
  fails(box({}, [sized]), 'desktop', 'the box of an Svg has a width')
  fails(sized, 'desktop', 'an Svg sits in a Box')
  fails(box({ width: 3, flexShrink: 0 }, [E.Text({ children: [sized] })]), 'desktop', 'an Svg sits in a Box')
  // An Svg in the column itself takes the width of the column, not of its cells
  fails(tableOf(rowOf(column(3, [sized]))), 'desktop', 'an Svg does not sit directly in a column')
  // The text of this column has its width, so only the Svg is wrong
  const onTerminal = (children: unknown[]) => tableOf(rowOf(column(3, children)))
  expect(() => checkAligned(onTerminal([words('abc')]), 'terminal')).not.toThrow()
  fails(onTerminal([words('abc'), sized]), 'terminal', 'has no Svg')
})

// A heat colour has two uses. A word or a number is text, and it has the text colour (heatText). A block glyph and an Svg document are graphics, and they have heat itself
const GLYPHS = /^[█▏▎▍▌▋▊▉▁▂▃▄▅▆▇]+$/
const isGlyph = (t: Node) => GLYPHS.test(flat(t).trim())
const coloured = (tree: unknown) => all(tree, 'Text').filter((t) => typeof t.props.color === 'string')
const wordColours = (tree: unknown) => coloured(tree).filter((t) => !isGlyph(t)).map((t) => [flat(t).trim(), t.props.color])
const glyphColours = (tree: unknown) => coloured(tree).filter(isGlyph).map((t) => t.props.color)
// The heat colours of the first `count` cells of a bar of n cells
const cellColours = (count: number, n: number) => Array.from({ length: count }, (_, i) => heat((i + 0.5) / n))
// The Svg documents of a tree must hold the heat colours of the cells, and none of the text colours that differ from them
function expectGraphic(tree: unknown, sources: string[], colours: string[], texts: number[]) {
  expect(all(tree, 'Svg').map((v) => v.props.source)).toEqual(sources)
  for (const colour of colours) expect(sources.some((src) => src.includes('fill="' + colour + '"'))).toBe(true)
  for (const x of texts) for (const src of sources) expect(src).not.toContain(heatText(x))
}

test('stage words, percents and the resume mark use heatText, and block glyphs and Svg documents use heat, on both surfaces', async () => {
  // These values sit where heat and heatText differ, so that a swap of the two shows
  const hot = 1 - 13 / 60
  for (const x of [hot, 0.6, 0.7]) expect(heatText(x)).not.toBe(heat(x))
  const { main, totals } = oneRequest()
  const band = bandData(main, totals, LIMITS, T0, T0 + 13 * MIN)!
  const nowRows = [row({ isCurrent: true, lastMainRequestAt: T0 - 13 * MIN }), row({ key: 'run:b:1', lastMainRequestAt: T0 - 24 * MIN })]
  const week = { ...WEEK, percent: 70, history: [{ char: '▇', percent: 70, isFuture: false }], byRepo: [], byModelScope: [] }
  const why = { ...WHY, total: 700_000 }
  const evenCauses = { ...SESSION, causes: { start: { tokens: 1, cost: 1 }, growth: { tokens: 2, cost: 2 }, resume: { tokens: 1, cost: 1 } } }
  for (const surface of SURFACES) {
    const onTerminal = surface === 'terminal'
    // The band: the stage word is text, the tube is a graphic (7 full cells and one partial cell are coloured)
    const bandTree = bandEls(E, band, surface)
    expect(wordColours(bandTree), surface).toEqual([['HOT', heatText(hot)]])
    expect(glyphColours(bandTree), surface).toEqual(onTerminal ? cellColours(8, 10) : [])
    if (!onTerminal) expectGraphic(bandTree, [barSvg(hot, 10)], cellColours(8, 10), [0.55, 0.65])
    // Tab 1: the stage words are text, the tubes are graphics
    const nowTree = nowEls(E, nowRows, T0, surface)
    expect(wordColours(nowTree), surface).toEqual([['HOT', heatText(hot)], ['WARM', heatText(0.6)]])
    expect(glyphColours(nowTree), surface).toEqual(onTerminal ? [...cellColours(7, 8), ...cellColours(5, 8)] : [])
    if (!onTerminal) expectGraphic(nowTree, [barSvg(hot, 8), barSvg(0.6, 8)], cellColours(7, 8), [0.6, 0.7])
    // Tab 3: the percent is text, the bar and the history are graphics
    const weekTree = tablesOf(weekEls(E, week, undefined, surface))[0]
    expect(wordColours(weekTree), surface).toEqual([['70%', heatText(0.7)]])
    expect(glyphColours(weekTree), surface).toEqual(onTerminal ? [...cellColours(14, 20), heat(0.7)] : [])
    if (!onTerminal) expectGraphic(weekTree, [barSvg(0.7, 20), sparkSvg(week.history)], [...cellColours(14, 20), heat(0.7)], [0.7])
    // Tab 4: the percent of the context row is text, its bar is a graphic
    const whyTree = tablesOf(whyEls(E, why, undefined, surface))[0]
    expect(wordColours(whyTree), surface).toEqual([['70%', heatText(0.7)]])
    expect(glyphColours(whyTree), surface).toEqual(onTerminal ? cellColours(14, 20) : [])
    if (!onTerminal) expectGraphic(whyTree, [barSvg(0.7, 20)], cellColours(14, 20), [0.7])
    // Tab 2: the mark of a resume is text, the bars of the causes and the strip are graphics
    const sessionTree = sessionEls(E, evenCauses, undefined, surface)
    expect(wordColours(sessionTree), surface).toEqual([['▲', heatText(1)]])
    const strip = stripCells(SESSION.requests, SESSION.now).filter((c) => c.char === '█').map((c) => c.color)
    expect(glyphColours(sessionTree), surface).toEqual(onTerminal ? [...cellColours(5, 20), ...cellColours(10, 20), ...cellColours(5, 20), ...strip] : [])
    if (!onTerminal) expect(all(sessionTree, 'Svg').map((v) => v.props.source).slice(-1)).toEqual([stripSvg(stripCells(SESSION.requests, SESSION.now))])
  }
})

// Tab 5, the help. Its text is the approved mockup, in tests/help-text.ts
const HELP_HEADINGS = HELP_SECTIONS.map((s) => s.title)
const HELP_ROWS = HELP_SECTIONS.flatMap((s) => s.rows)
const BLANK = ' '
// A fraction for each stage word of the help, with the stage that it must give
const HELP_STAGES: [string, number][] = [['LIVE', 1], ['HOT', 0.9], ['WARM', 0.5], ['COOLING', 0.2], ['COLD', 0]]
const helpOf = (surface: string, available?: number) => helpEls(E, available, surface) as Node
// The row of a term: its term column and its explanation column
function helpRow(tree: Node, term: string, explanation: string): Node[] {
  const rows = kids(tree).filter((n) => n.type === 'Box' && flat(kids(n)[1]) === explanation)
  expect(rows, term).toHaveLength(1)
  return kids(rows[0])
}

test('the help tab has the sections, the terms and the explanations of the approved text, in order, on both surfaces', async () => {
  for (const surface of SURFACES) {
    const root = kids(helpOf(surface))
    let at = 0
    for (const [si, section] of HELP_SECTIONS.entries()) {
      if (si > 0) {
        // A blank line between sections
        expect(root[at].type, surface).toBe('Text')
        expect(flat(root[at++]), surface).toBe(BLANK)
      }
      const heading = root[at++]
      expect(heading.type, section.title).toBe('Text')
      expect(flat(heading), surface).toBe(section.title)
      expect(heading.props.bold, section.title).toBe(true)
      for (const [term, explanation] of section.rows) {
        const row = root[at++]
        expect(row.type, term).toBe('Box')
        expect(row.props.flexDirection, term).toBe('row')
        const [termColumn, textColumn] = kids(row)
        // A term column has a fixed width of 22 cells
        expect(termColumn.type, term).toBe('Box')
        expect(termColumn.props.width, term).toBe(22)
        expect(termColumn.props.flexShrink, term).toBe(0)
        // The tube row has no text term: it holds the tube only
        if (term !== '') expect(flat(termColumn), surface + ' ' + term).toBe(term)
        else expect(flat(termColumn), surface).toBe(surface === 'terminal' ? '▕████░░░░░░▏' : '')
        // The explanation is one Text that wraps, in its own column that shrinks
        expect(textColumn.type, term).toBe('Box')
        expect(textColumn.props.flexShrink, term).toBe(1)
        expect(kids(textColumn), term).toHaveLength(1)
        const explainer = kids(textColumn)[0]
        expect(explainer.type, term).toBe('Text')
        expect(flat(explainer), term).toBe(explanation)
        // Plain: no colour, no dimming, no bold
        expect(Object.keys(explainer.props).sort(), term).toEqual(['children', 'wrap'])
        expect(explainer.props.wrap, term).toBe('wrap')
      }
    }
    expect(at, surface).toBe(root.length)
  }
})

test('a term of the help tab is as long as a table column leaves, so that the explanation starts at one column', async () => {
  for (const [term] of HELP_ROWS) expect(Array.from(term).length, term).toBeLessThanOrEqual(21)
  expect(HELP_ROWS).toHaveLength(40)
  expect(HELP_HEADINGS).toEqual(['Band above the prompt', '1 Now', '2 Session', '3 Week', '4 Why', 'Costs', '/token-watch'])
})

test('the drawn terms of the help tab have the style of the place where they show, and every other term is plain', async () => {
  const stageColours = HELP_STAGES.map(([, f]) => heatText(f))
  // The five stage words have five different colours
  expect(new Set(stageColours).size).toBe(5)
  for (const surface of SURFACES) {
    const onTerminal = surface === 'terminal'
    const tree = helpOf(surface)
    const drawn = new Set(['', ...HELP_STAGES.map(([stage]) => stage), 'highlighted row', '▲ $3.37'])
    for (const [term, explanation] of HELP_ROWS) {
      if (drawn.has(term)) continue
      const [termColumn] = helpRow(tree, term, explanation)
      expect(kids(termColumn), term).toHaveLength(1)
      expect(Object.keys(kids(termColumn)[0].props), term).toEqual(['children'])
    }
    // Stage words: bold, in the text colour of a heat inside the range of the stage
    for (const [stage, f] of HELP_STAGES) {
      expect(stageOf(f, stage === 'LIVE'), stage).toBe(stage)
      const [termColumn] = helpRow(tree, stage, HELP_ROWS.find(([t]) => t === stage)![1])
      expect(kids(termColumn), stage).toHaveLength(1)
      expect(kids(termColumn)[0].props, stage).toEqual({ bold: true, color: heatText(f), children: [stage] })
    }
    // The selected row of tab 1: bold text in a Box with the background, and no background on the Text or on the column
    const [selectedColumn] = helpRow(tree, 'highlighted row', 'This session.')
    expect(selectedColumn.props.backgroundColor).toBeUndefined()
    expect(kids(selectedColumn)).toHaveLength(1)
    const selected = kids(selectedColumn)[0]
    expect(selected.type).toBe('Box')
    expect(selected.props.backgroundColor).toBe('selectionBg')
    expect(selected.props.flexShrink).toBe(0)
    expect(kids(selected)).toHaveLength(1)
    expect(kids(selected)[0].props).toEqual({ bold: true, children: ['highlighted row'] })
    expect(all(tree, 'Text').filter((t) => t.props.backgroundColor !== undefined)).toHaveLength(0)
    expect(all(tree, 'Box').filter((b) => b.props.backgroundColor !== undefined)).toEqual([selected])
    // The resume mark: the triangle in the text colour of the hottest heat, then the cost
    const [resumeColumn] = helpRow(tree, '▲ $3.37', 'A resume and the cost of its cache write.')
    expect(kids(resumeColumn).map((t) => t.props)).toEqual([{ color: heatText(1), children: ['▲'] }, { children: [' $3.37'] }])
    // The tube row: 10 cells at 40%, no text term
    const [tubeColumn] = helpRow(tree, '', HELP_ROWS[0][1])
    if (onTerminal) {
      const cells = tubeCells(0.4, 10)
      expect(kids(tubeColumn).map((t) => t.props.children), surface).toEqual([['▕'], ...cells.map((c) => [c.char]), ['▏']])
      expect(kids(tubeColumn).map((t) => t.props.dimColor), surface).toEqual([true, ...cells.map((c) => (c.isEmpty ? true : undefined)), true])
      expect(kids(tubeColumn).map((t) => t.props.color), surface).toEqual([undefined, ...cells.map((c) => (c.isEmpty ? undefined : c.color)), undefined])
      expect(flat(tubeColumn)).toBe('▕████░░░░░░▏')
      expect(all(tree, 'Svg')).toHaveLength(0)
    } else {
      // On the desktop the tube is one Svg in a Box of its 10 cells: no tube character, no width or height on the Svg
      expect(kids(tubeColumn)).toHaveLength(1)
      expect(kids(tubeColumn)[0].props.width).toBe(10)
      expect(kids(tubeColumn)[0].props.flexShrink).toBe(0)
      const svgs = all(tree, 'Svg')
      expect(svgs).toHaveLength(1)
      expect(svgs[0].props).toEqual({ source: barSvg(0.4, 10), alt: tubeAlt(0.4) })
      expect(svgs[0].props.alt).toBe('cache 40% left')
      expect(kids(kids(tubeColumn)[0])[0]).toBe(svgs[0])
      for (const ch of ALL_BAR_CHARS) expect(all(tree, 'Text').filter((t) => flat(t).includes(ch)), ch).toEqual([])
    }
  }
})

test('the help tab on a surface without Svg draws the tube as cells', async () => {
  const tree = helpEls(NO_SVG, undefined, 'desktop') as Node
  expect(all(tree, 'Svg')).toHaveLength(0)
  expect(flat(kids(kids(tree)[1])[0])).toBe('▕████░░░░░░▏')
})

test('the explanation of the help tab wraps in the room that the term column leaves, so a narrow pane cuts nothing', async () => {
  const widths: [number | undefined, number | undefined][] = [[90, 68], [80, 58], [62, 40], [45, 23], [30, 12], [10, 12], [undefined, undefined], [Number.NaN, undefined]]
  for (const surface of SURFACES) {
    for (const [available, room] of widths) {
      const where = surface + ' at ' + available
      const tree = helpOf(surface, available)
      const rows = kids(tree).filter((n) => n.type === 'Box')
      expect(rows, where).toHaveLength(HELP_ROWS.length)
      for (const [i, [term, explanation]] of HELP_ROWS.entries()) {
        const textColumn = kids(rows[i])[1]
        expect(textColumn.props.width, where + ' ' + term).toBe(room)
        expect(textColumn.props.flexShrink, where + ' ' + term).toBe(1)
        // The whole text is in one Text that wraps: nothing is cut, and no ellipsis is drawn
        expect(flat(textColumn), where + ' ' + term).toBe(explanation)
        expect(kids(textColumn)[0].props.wrap, where + ' ' + term).toBe('wrap')
        expect(kids(rows[i])[0].props.width, where + ' ' + term).toBe(22)
        expect(kids(rows[i])[0].props.flexShrink, where + ' ' + term).toBe(0)
      }
      expect(all(tree, 'Text').filter((t) => t.props.wrap === 'truncate-end'), where).toHaveLength(0)
      expect(flat(tree).includes('…'), where).toBe(false)
      // Every word of every explanation is in the tree
      const words = new Set(all(tree, 'Text').flatMap((t) => flat(t).split(/\s+/)))
      for (const [, explanation] of HELP_ROWS) for (const word of explanation.split(/\s+/)) expect(words.has(word), where + ' ' + word).toBe(true)
    }
  }
})

test('the help tab is one tree on both surfaces: the same rows, and an Svg only for the tube', async () => {
  const terminal = helpOf('terminal')
  const desktop = helpOf('desktop')
  expect(kids(terminal)).toHaveLength(kids(desktop).length)
  // Only the tube row differs, and the Svg of the desktop sits in a Box with a width and has no size of its own
  const holders = svgHolders(desktop)
  expect(holders).toHaveLength(1)
  expect(holders[0][1]?.type).toBe('Box')
  expect(holders[0][1]?.props.width).toBe(10)
  expect(holders[0][1]?.props.flexShrink).toBe(0)
  expect(holders[0][0].props.width).toBeUndefined()
  expect(holders[0][0].props.height).toBeUndefined()
  expect(svgHolders(terminal)).toHaveLength(0)
  expect(all(terminal, 'Svg')).toHaveLength(0)
  // The tree of the terminal is also the tree of a desktop whose element table has no Svg
  expect(helpEls(NO_SVG, undefined, 'desktop')).toEqual(terminal)
})

test('the terms of the help tab are the labels that the band and the other tabs draw', async () => {
  // A digit group and its unit stand for any number: 47m, 412k and 31M are examples. A day name stands for any day
  const shape = (value: string) => value.replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g, 'Day').replace(/\d+(\.\d+)?[kM]?/g, '#')
  const terms = (title: string) => HELP_SECTIONS.find((s) => s.title === title)!.rows.map(([term]) => term)
  // A term lists labels with a comma. The labels of a tab, as its table and grid draw them
  const labels = {
    now: ['ctx', '60 min', 'today'],
    session: ['scope', 'req', 'input', 'c.write', 'c.read', 'estimate', 'reported', 'start', 'growth', 'resume', 'cache, last 4 h'],
    week: ['week', 'resets', 'at the current rate', 'week used, over time', 'by repo', 'by model'],
  }
  expect(terms('1 Now').slice(1).join(', ')).toBe(labels.now.join(', '))
  expect(terms('2 Session').slice(0, -1).join(', ')).toBe(labels.session.join(', '))
  expect(terms('3 Week').join(', ')).toBe(labels.week.join(', '))
  // The headings of the tabs are the numbers and the labels of the tab bar
  expect(HELP_HEADINGS.slice(1, 5)).toEqual(TAB_LABELS.slice(0, 4).map((label, i) => i + 1 + ' ' + label))
  // The band: each term has the shape of a part of the band line. The stage words are the stages
  let totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3.11))
  totals = addTo(totals, 'claude-sonnet-5-5', 'main', countsOf(SONNET, 0.5))
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0.2, '1h', '1h')
  // The 5-hour window started 20 minutes before the reading: at 12%, it reaches 100% before its reset, and the week has no reset time
  const projected = [
    { kind: 'seven_day', percentUsed: 41 },
    { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(T0 + 280 * MIN).toISOString() },
  ]
  const band = shape(flat(bandEls(E, bandData(main, totals, projected, T0, T0 + 13 * MIN)!)))
  const bandTerms = terms('Band above the prompt').slice(6)
  // The band draws the label of an unknown cache life in place of the tube, before the mod has read the life
  const unknown = shape(flat(bandEls(E, bandData({ ...main, ttl: null }, totals, projected, T0, T0 + 13 * MIN)!)))
  for (const term of bandTerms.slice(0, -2)) expect(term === UNKNOWN_LIFE ? unknown : band, term).toContain(shape(term))
  // The last two terms are the buttons. The terminal draws the pane button as `[ label ]` and the plain hide button as its label
  const [pane, hide] = all(bandEls(E, bandData(main, totals, projected, T0, T0 + 13 * MIN)!, 'terminal', 120, { isPaneOpen: false, onPane: () => {}, onHide: () => {} }), 'Button')
  expect(bandTerms.slice(-2)).toEqual(['[ ' + pane.props.label + ' ]', hide.props.label])
  expect(terms('Band above the prompt').slice(1, 6)).toEqual(HELP_STAGES.map(([stage]) => stage))
  // Tab 1: the header cells, and the selected row
  const now = nowEls(E, [row({ isCurrent: true })], T0)
  for (const label of labels.now) expect(flat(now), label).toContain(label)
  expect(all(now, 'Box').find((b) => b.props.backgroundColor !== undefined)?.props.backgroundColor).toBe('selectionBg')
  // Tab 2: the header cells, the labels of the total, the three causes, the history, and the mark of a resume
  const session = sessionEls(E, SESSION)
  for (const label of labels.session) expect(flat(session), label).toContain(label)
  expect(wordColours(session)).toEqual([['▲', heatText(1)]])
  // Tab 3: the labels of the head grid and the titles of the tables
  const week = flat(weekEls(E, WEEK))
  for (const label of labels.week) expect(week, label).toContain(label)
  // Tab 4: the label of the context row
  expect(flat(whyEls(E, WHY))).toContain(terms('4 Why')[0])
  // Costs: the mark of a fallback price and the word of a model without a price
  expect(markedCell('opus-5-6', SESSION_COLUMNS[0]).trim()).toBe(terms('Costs')[1])
  expect(nowCells(row({ model: 'unknown-model' }), T0)[4]).toBe(terms('Costs')[2])
})

// The dialog of /token-watch recommend, drawn from its state
const DIALOG: Recommend = { id: 1, phase: 'confirm', model: 'sonnet', priceModel: 'claude-sonnet', prompt: 'p', inputTokens: 1_300, outputCap: 4_000, maxCost: 0.0426, text: '', counts: null }
const ACTIONS = { onAsk: () => undefined, onCancel: () => undefined }

test('the dialog shows the cost before the call, the wait, the reply and the reason, in its phases', async () => {
  const confirm = flat(recommendEls(E, DIALOG, ACTIONS, 80))
  expect(confirm).toContain('Ask sonnet for recommendations on this usage?')
  expect(confirm).toContain('≈ 1.3k tokens, estimated from the length of the prompt')
  expect(confirm).toContain('up to 4.0k tokens')
  expect(confirm).toContain('≈ $0.04 at API prices of sonnet-5-5, with the full output cap')
  expect(all(recommendEls(E, DIALOG, ACTIONS, 80), 'Button').map((b) => b.props.key)).toEqual(['recommend-ask', 'recommend-cancel'])
  // A model without a price in the table has no cost
  const unpriced = flat(recommendEls(E, { ...DIALOG, model: 'mythos', priceModel: 'claude-mythos', maxCost: null }, ACTIONS, 80))
  expect(unpriced).toContain('unknown: the table of the mod has no price for this model')
  // A full id with an exact price has no ≈
  expect(flat(recommendEls(E, { ...DIALOG, model: 'claude-opus-5-5', priceModel: 'claude-opus-5-5', maxCost: 0.0852 }, ACTIONS, 80))).toContain('$0.09 at API prices of opus-5-5')
  const asking = recommendEls(E, { ...DIALOG, phase: 'asking' }, ACTIONS, 80)
  expect(flat(asking)).toContain('Asking sonnet…')
  expect(all(asking, 'Button').map((b) => b.props.key)).toEqual(['recommend-cancel'])
  const counts = { input: 2_400, output: 800, cacheRead: 0, cacheWrite: 0, requests: 1, cost: 0.0128 }
  const answered = recommendEls(E, { ...DIALOG, phase: 'answered', text: '## One\n\nText.', counts }, ACTIONS, 80)
  expect(all(answered, 'Markdown').map((m) => m.props.text)).toEqual(['## One\n\nText.'])
  expect(all(answered, 'Button')).toEqual([])
  expect(flat(answered)).toContain('sonnet · input 2.4k · output 800 · ≈ $0.01 at API prices · counted in the Session tab under the scope recommend')
  const failed = flat(recommendEls(E, { ...DIALOG, phase: 'failed', text: 'The model sent a reply without text.' }, ACTIONS, 80))
  expect(failed).toContain('No recommendations\nThe model sent a reply without text.')
  expect(failed).not.toContain('counted in the Session tab')
  expect(flat(recommendEls(E, null, ACTIONS, 80))).toBe('Run /token-watch recommend to ask for recommendations.')
})

test('a narrow dialog keeps the label column and gives the value at least 20 cells', async () => {
  const rows = (available?: number) => all(recommendEls(E, DIALOG, ACTIONS, available), 'Box').filter((b) => b.props.width === 15)
  expect(rows(80)).toHaveLength(5)
  const values = (available?: number) => all(recommendEls(E, DIALOG, ACTIONS, available), 'Box').filter((b) => b.props.flexShrink === 1).map((b) => b.props.width)
  expect(values(80)).toEqual([65, 65, 65, 65, 65])
  expect(values(30)).toEqual([20, 20, 20, 20, 20])
  expect(values(undefined)).toEqual([undefined, undefined, undefined, undefined, undefined])
})

test('the band shows the label of an unknown cache life in place of the tube, and the Now row shows no cache for it', async () => {
  const totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3.11))
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0.2, '1h', null)
  const d = bandData(main, totals, [], null, T0 + 13 * MIN)!
  expect(d.fraction).toBeNull()
  expect(d.label).toBe('cache life unknown · last request 13m ago')
  expect(flat(bandEls(E, d))).toContain('cache life unknown · last request 13m ago')
  expect(nowCells(row({ mainTtl: null, lastMainRequestAt: T0 - 13 * MIN }), T0)[0]).toBe('')
  expect(nowCells(row({ mainTtl: '5m', lastMainRequestAt: T0 - MIN }), T0)[0]).toMatch(/ 4m$/)
})

test('the band counts down a 5-minute cache life and prices the re-warm with the 5-minute write', async () => {
  const totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3.11))
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0.2, '5m', '5m')
  const d = bandData(main, totals, [], null, T0 + 3 * MIN)!
  expect(d.stage).toBe('WARM')
  expect(d.label).toBe('2m left · 411k cached · $5.14 to re-warm')
})

test('a band with only the label of an unknown cache life still shows, without limits and without models', async () => {
  // A resume within 5 minutes with an API key: no limits, no totals yet, and both lives fit
  const main = { ...NO_MAIN, lastRequestAt: T0 - 2 * MIN, ttl: null, contextTokens: 380_000, model: 'claude-opus-5-5' }
  const d = bandData(main, {}, [], null, T0)
  expect(d).not.toBeNull()
  expect(flat(bandEls(E, d!))).toContain('cache life unknown · last request 2m ago')
  // Without a request the band stays away
  expect(bandData(NO_MAIN, {}, [], null, T0)).toBeNull()
})
