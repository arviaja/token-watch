import { expect, test } from 'claude-code/testing'
import { dayTime } from '../hooks/format'
import { heat, heatText } from '../hooks/temperature'
import { bandCells } from '../hooks/view'
import { FABLE, MIN, RESETS_AT, SONNET, T0, complete, harness, start, step } from './helpers'
import { HELP_SECTIONS } from './help-text'

const BAND = {
  plugin: 'token-watch',
  component: 'AbovePrompt',
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 160, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const PANE = {
  plugin: 'token-watch',
  component: 'Pane',
  requestId: 'token-watch',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'token-watch', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const

// The harness reads the weekly limit at T0, 51 hours after the start of the week, at 41%: the week reaches 100% before its reset.
// The 5-hour limit has no reset time, so it has no projection
const HOUR = 60 * MIN
const WEEK_START = Date.parse(RESETS_AT) - 7 * 24 * HOUR
const WEEK_FULL = ' → 100% ' + dayTime(WEEK_START + ((T0 - WEEK_START) * 100) / 41)
const LIMITS_TEXT = 'week 41%' + WEEK_FULL + ' · 5h 12%'
// The round bulb that stood before each tube. The code point is written as an escape, so that no file holds the character
const BULB = '\u25cf'
const HAS_BULB = new RegExp(BULB)

const SESSION_NOTE = 'estimate: the requests this mod saw, at API prices. /cost: the figure of Claude Code. It also counts requests that the mod does not see, for example compaction.'

// The text of a node that the engine drew, with all of its children
function textOf(node: any): string {
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

test('the band shows the hot tube and the stage after a request, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(13 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // find() returns the outer band Text first; pick the nested Text with exactly this child
    const texts = await ui.findAll({ type: 'Text' })
    const stage = texts.find((t: any) => JSON.stringify(t.children) === JSON.stringify(['HOT']))
    expect(stage?.props.color).toBe(heatText(1 - 13 / 60))
    expect(await ui.find({ type: 'Text', text: ' 47m left · 411k cached · $8.22 to re-warm' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LIMITS_TEXT })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band draws the tube as one Svg on the desktop and as text cells on the terminal', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(13 * MIN)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.alt).toBe('cache 78% left')
  expect(String(svgs[0].props.alt).startsWith('cache ')).toBe(true)
  expect(svgs[0].props.source).not.toContain('<circle')
  expect(await ui.find({ type: 'Text', text: HAS_BULB })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '█' })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: HAS_BULB })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '▕' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '█' })).toBeDefined()
  await ui.unmount()
})

test('the band draws the stage word in the text colour of heat and the tube in heat itself, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(13 * MIN)
  // This cell of the tube sits where heat and heatText differ, so that a swap of the two shows
  expect(heatText(0.55)).not.toBe(heat(0.55))
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const cells = (await ui.findAll({ type: 'Text' })).filter((t: any) => JSON.stringify(t.children) === JSON.stringify(['█']))
  // 7 full cells: the 8th cell holds a partial block
  expect(cells.map((t: any) => t.props.color)).toEqual(Array.from({ length: 7 }, (_, i) => heat((i + 0.5) / 10)))
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = (await ui.findAll({ type: 'Svg' }))[0]
  expect(svg.props.source).toContain('fill="' + heat(0.55) + '"')
  expect(svg.props.source).not.toContain(heatText(0.55))
  await ui.unmount()
})

const OPUS = { model: 'claude-opus-5-5', input_tokens: 3, output_tokens: 1100, cache_read_input_tokens: 289_000, cache_creation_input_tokens: 43_100 }

// The mounted band, with the given number of cells across it
const bandAt = (columns: number, surface: 'terminal' | 'desktop') => ({ ...BAND, viewport: { columns, rows: 40 }, props: { ...BAND.props, bodyColumns: columns }, surface })

// The line of the band and its cells. On the terminal the text holds the frame and the tube cells, one cell for each character.
// On the desktop the tube is the Svg, and the text has the widths of the proportional font
async function bandLine(ui: any, surface: string): Promise<{ text: string; cells: number }> {
  const line = (await ui.findAll({ type: 'Text' })).find((t: any) => t.props.wrap === 'truncate-end')
  const text = textOf(line)
  return { text, cells: surface === 'desktop' ? bandCells(text, true, true) : Array.from(text).length }
}

test('the band keeps one line at a narrow and at a wide width with three models, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  // The turn is live. Opus has the highest cost of the three models
  await step($, FABLE)
  await step($, OPUS)
  await step($, SONNET)
  for (const surface of SURFACES) {
    for (const columns of [60, 80, 100, 120, 160]) {
      const where = surface + ' at ' + columns
      const ui = await $.ui.mount(bandAt(columns, surface))
      const { text, cells } = await bandLine(ui, surface)
      expect(cells, where).toBeLessThanOrEqual(columns - 4)
      expect(text, where).toContain('LIVE in turn')
      // Only the model with the highest cost, then the count of the others
      expect(text.includes('fable-5-1 r'), where).toBe(false)
      expect(text.includes('sonnet-5-5 r'), where).toBe(false)
      // On the terminal the tube and the label take 40 cells, the limits 20, the weekly projection 17, the model 30 and the count of the others 10.
      // On the desktop the same parts take 32.62, 15.41, 12.75, 22.05 and 8.26 cells. The weekly projection stays longer than the model
      const from = surface === 'terminal' ? { limits: 80, projection: 100, model: 120, more: 160 } : { limits: 60, projection: 80, model: 100, more: 100 }
      expect(text.includes('week 41%'), where).toBe(columns >= from.limits)
      expect(text.includes(LIMITS_TEXT), where).toBe(columns >= from.projection)
      expect(text.includes('opus-5-5 r289k w43.1k o1.1k'), where).toBe(columns >= from.model)
      expect(text.endsWith(' +2 models'), where).toBe(columns >= from.more)
      await ui.unmount()
    }
  }
})

test('the band shows when both limits reach 100%, drops the 5-hour projection first, and hides a time that has passed, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  // The 5-hour window started 2 hours before T0 and is at 62%: 100% after 193.5 minutes of its 300, at T0 + 73.5 minutes
  const fiveStart = T0 - 2 * HOUR
  const rateLimits = [
    { kind: 'seven_day', percentUsed: 41, resetsAt: RESETS_AT },
    { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(fiveStart + 5 * HOUR).toISOString() },
  ]
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits, changed: ['rateLimits'] })
  await h.clock.advance(13 * MIN)
  const fiveFull = ' → 100% ' + dayTime(fiveStart + (2 * HOUR * 100) / 62)
  const both = 'week 41%' + WEEK_FULL + ' · 5h 62%' + fiveFull
  const weekOnly = 'week 41%' + WEEK_FULL + ' · 5h 62%'
  const model = 'fable-5-1 r400k w10.0k o1.0k'
  // With the HOT label, both projections take 112 cells on the terminal and the model 31 more.
  // On the desktop they take 88.42 cells and the model 22.50 more, so the same parts stay at smaller widths
  const cases: Record<string, [number, string][]> = {
    terminal: [
      [160, '| ' + both + ' | ' + model],
      [120, '| ' + both],
      [100, '| ' + weekOnly],
      [90, '| week 41% · 5h 62%'],
    ],
    desktop: [
      [160, '| ' + both + ' | ' + model],
      [100, '| ' + both],
      [90, '| ' + weekOnly],
      [70, '| week 41% · 5h 62%'],
    ],
  }
  for (const surface of SURFACES) {
    for (const [columns, end] of cases[surface]) {
      const ui = await $.ui.mount(bandAt(columns, surface))
      const { text, cells } = await bandLine(ui, surface)
      expect(text.endsWith(end), surface + ' at ' + columns + ': ' + text).toBe(true)
      expect(cells, surface + ' at ' + columns).toBeLessThanOrEqual(columns - 4)
      await ui.unmount()
    }
  }
  // 80 minutes after the reading: the 5-hour time has passed, the age shows, and the weekly time is still that of the reading
  await h.clock.advance(67 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const { text } = await bandLine(ui, surface)
    expect(text, surface).toContain('| ' + weekOnly + ' (1h ago) | ' + model)
    expect(text, surface).not.toContain(fiveFull)
    await ui.unmount()
  }
})

test('a /clear keeps the time of the last limit reading, so the band shows its age and the pace up to that reading, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  // Two hours without a request: the limits of the session are still those of the last response, read at T0
  await h.clock.advance(2 * HOUR)
  await $.classic.SessionStart({ source: 'clear' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: LIMITS_TEXT + ' (2h ago)' }), surface).toBeDefined()
    await ui.unmount()
  }
})

test('the band is not cut to a width when the engine gives no number of cells', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await step($, SONNET)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: undefined }, surface })
    const { text } = await bandLine(ui, surface)
    expect(text.endsWith('| ' + LIMITS_TEXT + ' | fable-5-1 r400k w10.0k o1.0k +1 model'), surface).toBe(true)
    await ui.unmount()
  }
})

test('the band and the five tabs draw no bulb and no circle, on both surfaces and at each stage', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await $.command.run({ command: 'token-watch', args: '' })
  const check = async () => {
    for (const surface of SURFACES) {
      for (const view of [BAND, PANE]) {
        const ui = await $.ui.mount({ ...view, surface })
        for (const key of view === PANE ? ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'] : [undefined]) {
          if (key !== undefined) await ui.press({ key })
          for (const t of await ui.findAll({ type: 'Text' })) expect(textOf(t).includes(BULB)).toBe(false)
          for (const v of await ui.findAll({ type: 'Svg' })) expect(String(v.props.source).includes('<circle')).toBe(false)
        }
        await ui.unmount()
      }
    }
  }
  // LIVE during the turn, then HOT, WARM and COLD
  await check()
  await complete($)
  for (const minutes of [13, 18, 44]) {
    await h.clock.advance(minutes * MIN)
    await check()
  }
})

test('the band shows LIVE during a turn and COLD after 60 minutes', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'LIVE' })).toBeDefined()
  await ui.unmount()
  await complete($)
  await h.clock.advance(75 * MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 15m · next message re-writes 411k ≈ $8.22' })).toBeDefined()
})

test('the band passes while a survey holds it, and draws nothing without data', async ($, on) => {
  harness(on)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'HOT' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await ui.unmount()
  await start($)
  ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'week 41% · 5h 12%' })).toBeUndefined()
})

test('the command opens the pane with focus and Esc, and prints nothing', async ($, on) => {
  const h = harness(on)
  await start($)
  const answer = await $.command.run({ command: 'token-watch', args: '' })
  expect(answer).toEqual({})
  expect(h.opened[0]).toMatchObject({ id: 'token-watch', title: 'token-watch', focus: true, closeOnEscape: true, columns: 80, rows: 24 })
})

test('the command says why the pane did not open', async ($, on) => {
  harness(on, { openResult: { deny: 'no pane slot' } })
  await start($)
  const answer = (await $.command.run({ command: 'token-watch', args: '' })) as { text?: string }
  expect(answer.text).toMatch(/^The token-watch pane did not open:/)
  expect(answer.text).toContain('no pane slot')
})

test('the command says why the pane waits', async ($, on) => {
  harness(on, { openResult: { value: { isPlaced: false, reason: 'terminal too narrow' } } })
  await start($)
  const answer = await $.command.run({ command: 'token-watch', args: '' })
  expect(answer).toEqual({ text: 'The token-watch pane is waiting: terminal too narrow' })
})

const OTHER = { v: 1, key: 'run:other:1', sessionId: 'other', repo: 'billing-service', model: 'claude-opus-5-5', updatedAt: T0, lastMainRequestAt: T0, contextTokens: 231_000, isWorking: false, readings: [], hours: {} }

// The row Boxes of the Now table: a row Box has no width and holds the column Boxes
// A row Box has no width, except a selected row, which ends with the table
const rowBoxes = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexDirection === 'row' && (b.props.width === undefined || b.props.backgroundColor !== undefined) && b.children.length > 1)

test('tab 1 draws the current session as a selected row and no marker, on both surfaces', async ($, on) => {
  harness(on, { store: { 'run:other:1': OTHER } })
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^webshop\s+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^billing-service\s+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^fable-5-1\s+$/ })).toBeDefined()
    // No Text holds the old marker
    for (const t of await ui.findAll({ type: 'Text' })) expect(textOf(t).includes('>'), surface).toBe(false)
    // The engine accepts backgroundColor on the row Box: the current row has the theme key, the other rows have none
    const rows = await rowBoxes(ui)
    const selected = rows.filter((r: any) => r.props.backgroundColor !== undefined)
    expect(selected, surface).toHaveLength(1)
    expect(selected[0].props.backgroundColor, surface).toBe('selectionBg')
    // The highlight ends with the table, not with the pane
    expect(selected[0].props.width, surface).toBe(80)
    expect(textOf(selected[0]), surface).toContain('webshop')
    expect(textOf(selected[0]), surface).not.toContain('billing-service')
    const other = rows.find((r: any) => textOf(r).includes('billing-service'))
    expect(other.props.backgroundColor, surface).toBeUndefined()
    // No Text has a background of its own: the Box carries it
    for (const t of await ui.findAll({ type: 'Text' })) expect(t.props.backgroundColor, surface).toBeUndefined()
    // The text cells of the current row are bold, the ones of the other row are not
    // The engine leaves out the props of a Text that has none
    const bold = (row: any) => row.children.slice(1).map((c: any) => c.children[0].props?.bold)
    expect(bold(selected[0]), surface).toEqual([true, true, true, true, true])
    expect(bold(other), surface).toEqual([undefined, undefined, undefined, undefined, undefined])
    await ui.unmount()
  }
})

test('a narrow pane keeps the selected row of tab 1, on both surfaces', async ($, on) => {
  harness(on, { store: { 'run:other:1': OTHER } })
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    for (const bodyColumns of [63, 45]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
      const selected = (await rowBoxes(ui)).filter((r: any) => r.props.backgroundColor === 'selectionBg')
      expect(selected, surface + ' at ' + bodyColumns).toHaveLength(1)
      expect(textOf(selected[0]), surface + ' at ' + bodyColumns).toContain('webshop')
      await ui.unmount()
    }
  }
})

test('tab 1 draws the cache column with an Svg and its own stage box on the desktop, and text cells on the terminal', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(31 * MIN)
  await $.command.run({ command: 'token-watch', args: '' })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.source).not.toContain('<circle')
  expect(await ui.find({ type: 'Text', text: HAS_BULB })).toBeUndefined()
  const boxes = await ui.findAll({ type: 'Box' })
  const stage = boxes.find((b: any) => b.props.width === 8 && JSON.stringify(b.children).includes('WARM'))
  expect(stage).toBeDefined()
  expect(boxes.some((b: any) => b.props.width === 5 && b.props.justifyContent === 'flex-end')).toBe(true)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: HAS_BULB })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '█' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'WARM' })).toBeDefined()
  await ui.unmount()
})

test('a narrow pane drops the ctx and model columns of tab 1', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  const narrow = { ...PANE, props: { ...PANE.props, bodyColumns: 63 } }
  for (const surface of SURFACES) {
    let ui = await $.ui.mount({ ...narrow, surface })
    expect(await ui.find({ type: 'Text', text: /^fable-5-1\s+$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^412k$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^webshop\s+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '60 min' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'today' })).toBeDefined()
    await ui.unmount()
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^fable-5-1\s+$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the tab keys switch to Session, Week and Why', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-2' })
  expect(await ui.find({ type: 'Text', text: /^main\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^cache, last 4 h\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '-4 h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^reported\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^by \/cost\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*\$39\.20$/ })).toBeDefined()
  await ui.press({ key: 'tab-3' })
  expect(await ui.find({ type: 'Text', text: /^week\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+41%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^resets\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^webshop\s+$/ })).toBeDefined()
  await ui.press({ key: 'tab-4' })
  expect(await ui.find({ type: 'Text', text: /^context of 1\.0M\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+412k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Messages\s+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^linear\s+$/ })).toBeDefined()
})

test('tabs 3 and 4 draw the bars as Svg on the desktop and as text cells on the terminal', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = async () => (await ui.findAll({ type: 'Svg' })).map((v: any) => v.props.alt)
  const barBoxes = async () => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 20 && JSON.stringify(b.children).includes('"type":"Svg"'))
  await ui.press({ key: 'tab-3' })
  // The meter, the history, and one bar for each of the two share tables
  expect(await alts()).toEqual(['week 41% used', 'week history, highest 41%', 'share 100%', 'share 100%'])
  expect(await barBoxes()).toHaveLength(3)
  // The history draws all 14 periods of the week, so its box is 14 cells wide
  const historyBoxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 14 && JSON.stringify(b.children).includes('"type":"Svg"'))
  expect(historyBoxes).toHaveLength(1)
  // The day axis under it is 7 Boxes of 2 cells with one letter each in the middle, and the future periods are an outline in the Svg, not a dot
  const days = /^[SMTWF]$/
  expect(await ui.findAll({ type: 'Text', text: days })).toHaveLength(7)
  expect((await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 2 && b.props.flexShrink === 0)).toHaveLength(7)
  expect(await ui.find({ type: 'Text', text: '·' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).some((v: any) => v.props.alt.startsWith('week history') && v.props.source.includes('fill="none"'))).toBe(true)
  for (const ch of ['█', '░', '▃']) expect(await ui.find({ type: 'Text', text: ch })).toBeUndefined()
  await ui.press({ key: 'tab-4' })
  expect(await alts()).toEqual(['context 41% used', 'share 77%'])
  expect(await barBoxes()).toHaveLength(2)
  for (const ch of ['█', '░']) expect(await ui.find({ type: 'Text', text: ch })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-3' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '█' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '░' })).toBeDefined()
  // The history shows the future periods as dots and has the day axis under it
  expect((await ui.findAll({ type: 'Text', text: '·' })).length).toBeGreaterThan(0)
  expect(await ui.findAll({ type: 'Text', text: /^[SMTWF] $/ })).toHaveLength(7)
  await ui.press({ key: 'tab-4' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '█' })).toBeDefined()
  await ui.unmount()
})

test('a narrow pane drops the bar column of tabs 3 and 4', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  const narrow = { ...PANE, props: { ...PANE.props, bodyColumns: 62 } }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...narrow, surface })
    await ui.press({ key: 'tab-4' })
    expect(await ui.find({ type: 'Text', text: /^Messages\s+$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 21)).toHaveLength(0)
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    await ui.press({ key: 'tab-3' })
    expect(await ui.find({ type: 'Text', text: /^webshop\s+$/ })).toBeDefined()
    // The head grid keeps its meter and history, the share tables lose their bars
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'desktop' ? 2 : 0)
    await ui.unmount()
  }
})

test('tab 2 labels the estimate and the reported cost, and draws the note under the main table, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-2' })
    expect(await ui.find({ type: 'Text', text: /^estimate\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^reported\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^by \/cost\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: SESSION_NOTE }), surface).toBeDefined()
    await ui.unmount()
  }
})

test('tab 2 draws the bars and the strip as four Svg on the desktop and as text cells on the terminal', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-2' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map((v: any) => v.props.alt)).toEqual(['share 100%', 'share 0%', 'share 0%', 'cache history of the last 4 hours'])
  expect(svgs.every((v: any) => v.props.width === undefined)).toBe(true)
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.filter((b: any) => b.props.width === 20 && JSON.stringify(b.children).includes('"type":"Svg"'))).toHaveLength(3)
  expect(boxes.filter((b: any) => b.props.width === 48 && JSON.stringify(b.children).includes('"type":"Svg"'))).toHaveLength(1)
  for (const ch of ['█', '░']) expect(await ui.find({ type: 'Text', text: ch })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-2' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '█' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '░' })).toBeDefined()
  await ui.unmount()
})

// The bar characters of the terminal and the characters of the sparkline
const BAR_TEXT = /[█░▏▎▍▌▋▊▉▁▂▃▄▅▆▇]/

// What each tab draws at 90 columns. widths: its first two columns, as the design doc names them. rows: the column widths of each table row, one list for each table.
// Session: main table, cause table, history grid. Why: context row and categories, lists.
const TABS = [
  { tab: 1, widths: [22, 21], rows: [[22, 21, 11, 6, 10, 10]] },
  { tab: 2, widths: [11, 14], rows: [[11, 16, 5, 7, 9, 7, 8, 10, 7], [14, 21, 8, 10, 6], [16, 49]] },
  { tab: 3, widths: [26, 21], rows: [[26, 21, 10, 6]] },
  { tab: 4, widths: [26, 21], rows: [[26, 21, 9, 7], [47, 9, 7]] },
  // Help: the term column and the explanation column, which takes the 90 columns that the term column leaves
  { tab: 5, widths: [22], rows: [[22, 68]] },
]

test('every tab draws the tree of the mod on both surfaces, with the bars of its surface and the column boxes of its tables', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    // Mounting checks the tree against the element table of the surface, so a tree that is drawn here is valid on it
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const { tab, widths, rows: expected } of TABS) {
      await ui.press({ key: 'tab-' + tab })
      const where = surface + ' tab ' + tab
      // The tab buttons are the tree of the mod; the text of the engine is the tree of a pane that is not ours
      expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key), where).toEqual(['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'])
      expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' }), where).toBeUndefined()
      if (surface === 'desktop') {
        expect((await ui.findAll({ type: 'Svg' })).length, where).toBeGreaterThan(0)
        expect(await ui.find({ type: 'Text', text: BAR_TEXT }), where).toBeUndefined()
      } else {
        expect(await ui.findAll({ type: 'Svg' }), where).toHaveLength(0)
        expect(await ui.find({ type: 'Text', text: /[█░]/ }), where).toBeDefined()
      }
      // A column box is a row Box with a width, so its width is in the widths of its row; the box of an Svg has no direction
      const boxes = await ui.findAll({ type: 'Box' })
      const columns = boxes.filter((b: any) => b.props.flexDirection === 'row' && typeof b.props.width === 'number').map((b: any) => b.props.width)
      for (const width of widths) expect(columns, where).toContain(width)
      const rows = boxes.filter((b: any) => b.props.flexDirection === 'row' && b.props.width === undefined).map((b: any) => b.children.map((c: any) => c.props.width))
      for (const columnWidths of expected) expect(rows, where).toContainEqual(columnWidths)
    }
    await ui.unmount()
  }
})

test('the mod leaves the panes of other mods alone', async ($, on) => {
  harness(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, requestId: 'other-pane', surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tab-1' })).toBeUndefined()
})

test('a resumed conversation shows its real cache temperature, and its first request counts as a resume', async ($, on) => {
  harness(on)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4500, context_tokens: 380_000, model: 'claude-opus-5-5' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 15m · next message re-writes 380k ≈ $3.04' })).toBeDefined()
  await ui.unmount()
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-2' })
  // A table row is a row Box without a width; its column boxes are row Boxes with one
  const tableRows = (await pane.findAll({ type: 'Box' })).filter((b: any) => b.props.flexDirection === 'row' && b.props.width === undefined)
  // The row of the cause table holds the whole cost of the cache writes
  const rows = tableRows.filter((b: any) => /^resume\s+$/.test(textOf(b.children[0])))
  expect(rows).toHaveLength(1)
  expect(textOf(rows[0].children[4])).toBe('  100%')
  // The resume is in the last cell of the strip. No label fits there, so the row of the resumes shows the cost before the mark
  const resumes = tableRows.filter((b: any) => /^resumes\s+$/.test(textOf(b.children[0])))
  expect(resumes).toHaveLength(1)
  expect(textOf(resumes[0].children[1])).toMatch(/^ {40}\$\d+\.\d\d {2}▲ $/)
  const axis = tableRows.filter((b: any) => textOf(b.children[1]).startsWith('-4 h'))
  expect(axis).toHaveLength(1)
  expect(textOf(axis[0].children[1])).toBe('-4 h'.padEnd(12) + '-3 h'.padEnd(12) + '-2 h'.padEnd(12) + '-1 h'.padEnd(9) + 'now' + ' ')
  expect(await pane.find({ type: 'Text', text: '▲' })).toBeDefined()
})

test('tab 2 draws the labelled strip, the resumes row and the time axis on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4500, context_tokens: 380_000, model: 'claude-opus-5-5' })
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-2' })
    expect(await ui.find({ type: 'Text', text: /^cache, last 4 h\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^resumes\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'last 4 h, one cell = 5 min' }), surface).toBeUndefined()
    const mark = await ui.find({ type: 'Text', text: '▲' })
    expect(mark?.props.color, surface).toBe(heatText(1))
    for (const label of ['-4 h', '-3 h', '-2 h', '-1 h', 'now']) expect((await ui.find({ type: 'Text', text: label }))?.props.dimColor, surface + ' ' + label).toBe(true)
    // The strip is the only drawing in the grid
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).map((v: any) => v.props.alt).slice(-1), surface).toEqual(['cache history of the last 4 hours'])
    await ui.unmount()
  }
})

test('a resume event without a model reads the model of the session', async ($, on) => {
  harness(on, { sessionModel: 'claude-opus-5-5' })
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4500, context_tokens: 380_000 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 15m · next message re-writes 380k ≈ $3.04' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'token-watch', args: '' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^opus-5-5\s+$/ })).toBeDefined()
})

test('a resume event without a model and a session without a model leave the model empty', async ($, on) => {
  harness(on)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4500, context_tokens: 380_000 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'next message re-writes 380k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '≈ $' })).toBeUndefined()
})

test('a /clear conversation seeds no cache temperature', async ($, on) => {
  harness(on)
  await start($)
  await $.classic.SessionStart({ source: 'clear', seconds_since_last_response: 4500, context_tokens: 380_000, model: 'claude-opus-5-5' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: LIMITS_TEXT })).toBeDefined()
})

test('a resumed conversation without a valid time or context seeds nothing', async ($, on) => {
  harness(on)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: -1, context_tokens: 380_000, model: 'claude-opus-5-5' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeUndefined()
  await ui.unmount()
  await $.classic.SessionStart({ source: 'fork', seconds_since_last_response: 100, context_tokens: 0 })
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: 'COLD' })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: 'HOT' })).toBeUndefined()
})

// The pane with a given number of cells across it
const paneAt = (columns: number, surface: 'terminal' | 'desktop') => ({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })

// The text of each Text that the pane drew
async function textsOf(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(textOf)
}

test('the tab bar has five labels, and the key 5 and the Help button select the help tab, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const buttons = async () => await ui.findAll({ type: 'Button' })
    expect((await buttons()).map((b: any) => b.props.label), surface).toEqual(['Now', 'Session', 'Week', 'Why', 'Help'])
    expect((await buttons()).map((b: any) => b.props.hotkey), surface).toEqual(['1', '2', '3', '4', '5'])
    // The selected tab stays when the pane is mounted again, so select tab 1 first. The other labels are dimmed, and the help is not drawn
    await ui.press({ key: 'tab-1' })
    expect((await buttons()).map((b: any) => b.props.dimColor), surface).toEqual([false, true, true, true, true])
    expect(await textsOf(ui), surface).not.toContain('Band above the prompt')
    await ui.press({ key: 'tab-5' })
    expect((await buttons()).map((b: any) => b.props.dimColor), surface).toEqual([true, true, true, true, false])
    expect(await textsOf(ui), surface).toContain('Band above the prompt')
    expect(await textsOf(ui), surface).toContain('Costs')
    // The data of the other tabs is not drawn
    expect(await ui.find({ type: 'Text', text: /^webshop\s+$/ }), surface).toBeUndefined()
    for (const key of ['tab-2', 'tab-3', 'tab-4', 'tab-1']) {
      await ui.press({ key })
      expect(await textsOf(ui), surface + ' ' + key).not.toContain('Band above the prompt')
    }
    await ui.press({ key: 'tab-5' })
    expect(await textsOf(ui), surface).toContain('Band above the prompt')
    await ui.unmount()
  }
})

test('the help tab draws every term and every explanation of the approved text, with its headings in bold, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-5' })
    const texts = await ui.findAll({ type: 'Text' })
    const drawn = texts.map(textOf)
    for (const section of HELP_SECTIONS) {
      const heading = texts.filter((t: any) => textOf(t) === section.title)
      expect(heading, surface + ' ' + section.title).toHaveLength(1)
      expect(heading[0].props.bold, section.title).toBe(true)
      for (const [term, explanation] of section.rows) {
        // The tube row has no text term. A term is one Text, or two Texts for the resume mark and its cost
        if (term !== '') expect(drawn.includes(term) || drawn.join('').includes(term), surface + ' ' + term).toBe(true)
        // The explanation is one Text. Its words are the words of the approved text, with one space between them
        const explainer = texts.filter((t: any) => textOf(t) === explanation)
        expect(explainer, surface + ' ' + explanation).toHaveLength(1)
        expect(explainer[0].props.wrap, explanation).toBe('wrap')
        expect(explainer[0].props.dimColor, explanation).toBeUndefined()
      }
    }
    // Each row holds a term column of 22 cells that does not shrink
    const columns = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 22 && b.props.flexShrink === 0)
    expect(columns, surface).toHaveLength(HELP_SECTIONS.flatMap((s) => s.rows).length)
    // The engine checked the tree against the element table of the surface
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' }), surface).toBeUndefined()
    await ui.unmount()
  }
})

test('the drawn terms of the help tab look like the band and the tabs, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-5' })
    const texts = await ui.findAll({ type: 'Text' })
    const one = (value: string) => {
      const found = texts.filter((t: any) => textOf(t) === value)
      expect(found, surface + ' ' + value).toHaveLength(1)
      return found[0]
    }
    // The stage words are bold, in the text colour of a heat inside their stage
    for (const [stage, f] of [['LIVE', 1], ['HOT', 0.9], ['WARM', 0.5], ['COOLING', 0.2], ['COLD', 0]] as const) {
      expect(one(stage).props.bold, stage).toBe(true)
      expect(one(stage).props.color, surface + ' ' + stage).toBe(heatText(f))
    }
    // The selected row: bold text in a Box with the background of the Now tab
    expect(one('highlighted row').props.bold).toBe(true)
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === 'selectionBg')
    expect(boxes.map(textOf), surface).toEqual(['highlighted row'])
    expect(texts.filter((t: any) => t.props.backgroundColor !== undefined), surface).toHaveLength(0)
    // The mark of a resume: the triangle in the colour of the hottest heat, then the cost
    expect(one('▲').props.color, surface).toBe(heatText(1))
    expect(one(' $3.37').props.color, surface).toBeUndefined()
    // The tube: 4 cells of 10 at 40%
    if (surface === 'terminal') {
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
      const cells = texts.filter((t: any) => textOf(t) === '█').slice(0, 4)
      expect(cells.map((t: any) => t.props.color)).toEqual([0, 1, 2, 3].map((i) => heat((i + 0.5) / 10)))
      expect(texts.filter((t: any) => textOf(t) === '░')).toHaveLength(6)
      expect(texts.filter((t: any) => textOf(t) === '▕' || textOf(t) === '▏').every((t: any) => t.props.dimColor === true)).toBe(true)
    } else {
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs.map((v: any) => v.props.alt)).toEqual(['cache 40% left'])
      expect(svgs[0].props.width).toBeUndefined()
      expect(svgs[0].props.height).toBeUndefined()
      expect(texts.filter((t: any) => BAR_TEXT.test(textOf(t)))).toHaveLength(0)
    }
    await ui.unmount()
  }
})

test('the help tab wraps its explanations at 45 columns and cuts nothing, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(paneAt(45, surface))
    await ui.press({ key: 'tab-5' })
    const texts = await ui.findAll({ type: 'Text' })
    const drawn = texts.map(textOf)
    for (const [, explanation] of HELP_SECTIONS.flatMap((s) => s.rows)) {
      const found = texts.filter((t: any) => textOf(t) === explanation)
      expect(found, surface + ' ' + explanation).toHaveLength(1)
      // It wraps in its column, the room that the term column leaves
      expect(found[0].props.wrap, explanation).toBe('wrap')
    }
    const room = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexShrink === 1 && b.props.width === 23)
    expect(room, surface).toHaveLength(HELP_SECTIONS.flatMap((s) => s.rows).length)
    expect(texts.filter((t: any) => t.props.wrap === 'truncate-end'), surface).toHaveLength(0)
    expect(drawn.some((value) => value.includes('…')), surface).toBe(false)
    // The term column keeps its 22 cells
    expect((await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.width === 22 && b.props.flexShrink === 0), surface).toHaveLength(room.length)
    await ui.unmount()
  }
})

test('the help tab needs no request and no store data, and keeps its text when a request comes', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: '' })
  // The pruning of old snapshots lists the keys 5 seconds after the start. It is done before the count starts
  await h.clock.advance(6_000)
  await h.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-5' })
  const before = await textsOf(ui)
  expect(before).toContain('Band above the prompt')
  const reads = h.keyCalls.count
  await step($, FABLE)
  await complete($)
  await h.clock.advance(13 * MIN)
  await h.clock.settle()
  // The help does not change with the data, and it lists no store key
  expect(await textsOf(ui)).toEqual(before)
  expect(h.keyCalls.count).toBe(reads)
  await ui.unmount()
})
