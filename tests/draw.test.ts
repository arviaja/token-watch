import { expect, test } from 'claude-code/testing'
import { clockTime, dayTime } from '../hooks/format'
import { heat, heatText } from '../hooks/temperature'
import { bandCells } from '../hooks/view'
import { formatTokens } from '../hooks/format'
import { RECOMMEND_SYSTEM, estimateTokens } from '../hooks/recommend'
import { FABLE, MIN, REPLY, RESETS_AT, SONNET, T0, complete, harness, start, step } from './helpers'
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

// The harness reads the weekly limit at T0, 51 hours after the start of the week, at 41%: at that pace the week runs out before its reset,
// so the band shows the action slow down. The 5-hour limit has no reset time, so it has no projection
const HOUR = 60 * MIN
const WEEK_START = Date.parse(RESETS_AT) - 7 * 24 * HOUR
const RUNS_OUT = 'runs out ' + dayTime(WEEK_START + ((T0 - WEEK_START) * 100) / 41)
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
    // The action takes the place of the re-warm price
    expect(await ui.find({ type: 'Text', text: ' 47m left · 411k cached' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'slow down' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: RUNS_OUT })).toBeDefined()
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

test('the band keeps one line at every width on both surfaces, names no model, and keeps the stage, the label and the action', async ($, on) => {
  harness(on)
  await start($)
  // The turn is live, and the last request is the one of Sonnet, so the model hint names Haiku
  await step($, FABLE)
  await step($, OPUS)
  await step($, SONNET)
  for (const surface of SURFACES) {
    // The narrowest band: only the parts that never leave
    const narrowest = await $.ui.mount(bandAt(20, surface))
    const minimal = (await bandLine(narrowest, surface)).text
    await narrowest.unmount()
    for (const columns of [60, 70, 80, 100, 110, 120, 130, 160]) {
      const where = surface + ' at ' + columns
      const ui = await $.ui.mount(bandAt(columns, surface))
      const { text, cells } = await bandLine(ui, surface)
      expect(text, where).toContain('LIVE in turn')
      expect(text, where).toContain('slow down or use Haiku')
      expect(text, where).toContain(RUNS_OUT)
      // The token counts per model are in the pane, not in the band
      expect(text, where).not.toMatch(/fable-5-1|sonnet-5-5|opus-5-5|\+\d models?/)
      // 4 free cells and 16 for the two buttons; wider only when nothing else can leave
      if (cells > columns - 4 - 16) expect(text, where).toBe(minimal)
      await ui.unmount()
    }
    const wide = await $.ui.mount(bandAt(160, surface))
    expect((await bandLine(wide, surface)).text, surface).toContain('week 41% · ' + RUNS_OUT)
    await wide.unmount()
  }
})

test('the band shows 5h full when the 5-hour window fills within the hour, with the 5-hour percent first, and drops it when the time has passed, on both surfaces', async ($, on) => {
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
  const fullAt = fiveStart + (2 * HOUR * 100) / 62
  // 13 minutes after the reading the window fills in 60.5 minutes: not within the hour yet, so the week action shows
  await h.clock.advance(13 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await bandLine(ui, surface)).text, surface).toContain('| slow down or use Sonnet | week 41% · ' + RUNS_OUT)
    await ui.unmount()
  }
  // One minute later it fills within the hour: the 5-hour action comes first, with its percent first and in the heat colour
  await h.clock.advance(MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const { text } = await bandLine(ui, surface)
    expect(text, surface).toContain('| 5h full at ' + clockTime(fullAt) + ': pause or use Sonnet | 5h 62% | week 41% · ' + RUNS_OUT)
    const percent = (await ui.findAll({ type: 'Text' })).find((t: any) => JSON.stringify(t.children) === JSON.stringify(['62%']))
    expect(percent?.props.color, surface).toBe(heatText(0.62))
    await ui.unmount()
  }
  // After the time of 100% the 5-hour action leaves, and the week action shows again
  await h.clock.advance(66 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const { text } = await bandLine(ui, surface)
    expect(text, surface).not.toContain('5h full')
    expect(text, surface).toContain('slow down or use Sonnet')
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
    expect(await ui.find({ type: 'Text', text: ' (2h ago)' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: RUNS_OUT }), surface).toBeDefined()
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
    expect(text.endsWith('| slow down or use Haiku | week 41% · ' + RUNS_OUT), surface + ': ' + text).toBe(true)
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

test('band off hides the band in this session at once and in another session at its next tick, and band on shows it again, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  const isBandDrawn = async (surface: string) => {
    const ui = await $.ui.mount({ ...BAND, surface })
    const isDrawn = (await ui.find({ type: 'Text', text: 'HOT' })) !== undefined
    // What Claude Code draws in the band stays in both cases
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' }), surface).toBeDefined()
    await ui.unmount()
    return isDrawn
  }
  for (const surface of SURFACES) expect(await isBandDrawn(surface), surface).toBe(true)
  await $.command.run({ command: 'token-watch', args: 'band off' })
  for (const surface of SURFACES) expect(await isBandDrawn(surface), surface).toBe(false)
  // Another session turns the band on. This session reads the store at its next tick
  h.store.set('settings', { band: 'on' })
  for (const surface of SURFACES) expect(await isBandDrawn(surface), surface).toBe(false)
  await h.clock.advance(15_000)
  await h.clock.settle()
  for (const surface of SURFACES) expect(await isBandDrawn(surface), surface).toBe(true)
})

test('a session that starts with the band off draws no band, and the command still opens the pane', async ($, on) => {
  const h = harness(on, { store: { settings: { band: 'off' } } })
  await start($)
  await step($, FABLE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'LIVE' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  expect(await $.command.run({ command: 'token-watch', args: '' })).toEqual({})
  expect(h.opened).toHaveLength(1)
})

test('the band button opens the pane and closes it, and its label follows the pane, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  const buttonOf = async (surface: string) => {
    const ui = await $.ui.mount({ ...BAND, surface })
    const button = (await ui.findAll({ type: 'Button' })).find((b: any) => b.props.key === 'pane')
    return { ui, button }
  }
  for (const surface of SURFACES) {
    let { ui, button } = await buttonOf(surface)
    // A bracketed button: not plain, dimmed, and the first focus of the band. The terminal has a letter as hotkey; the desktop has none, because it draws a hotkey as a badge
    expect(button?.props, surface).toMatchObject({ label: 'details', autoFocus: true, dimColor: true })
    expect(button?.props.hotkey, surface).toBe(surface === 'terminal' ? 't' : undefined)
    expect(button?.props.plain, surface).toBeUndefined()
    const opened = h.opened.length
    await ui.press({ key: 'pane' })
    expect(h.opened, surface).toHaveLength(opened + 1)
    expect(h.opened.at(-1), surface).toMatchObject({ id: 'token-watch', focus: true, closeOnEscape: true })
    await ui.unmount()
    ;({ ui, button } = await buttonOf(surface))
    expect(button?.props.label, surface).toBe('close')
    const closed = h.closed.length
    await ui.press({ key: 'pane' })
    expect(h.closed, surface).toHaveLength(closed + 1)
    await ui.unmount()
    ;({ ui, button } = await buttonOf(surface))
    expect(button?.props.label, surface).toBe('details')
    await ui.unmount()
  }
  // A press is no slash command: no toast, and nothing for the transcript
  expect(h.toasts).toEqual([])
})

test('the × hides the band in this session only, and band on shows it again, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const hide = (await ui.findAll({ type: 'Button' })).find((b: any) => b.props.key === 'band-hide')
    // The close control of the band: the glyph on both surfaces, because the desktop draws the label and no close mark in the band
    expect(hide?.props, surface).toMatchObject({ role: 'dismiss', plain: true, dimColor: true, label: '×' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'band-hide' })
  await ui.unmount()
  expect(h.toasts.at(-1)).toBe('Band hidden in this session. /token-watch band on shows it again.')
  // The store and so the other sessions stay unchanged
  expect(h.store.has('settings')).toBe(false)
  for (const surface of SURFACES) {
    const hidden = await $.ui.mount({ ...BAND, surface })
    expect(await hidden.find({ type: 'Text', text: 'HOT' }), surface).toBeUndefined()
    expect(await hidden.find({ type: 'Text', text: 'drawn by Claude Code' }), surface).toBeDefined()
    await hidden.unmount()
  }
  // The tick reads the store, but the hide of this session stays
  await h.clock.advance(15_000)
  await h.clock.settle()
  await $.command.run({ command: 'token-watch', args: 'band' })
  expect(h.toasts.at(-1)).toBe('The band is hidden in this session. /token-watch band on shows it.')
  await $.command.run({ command: 'token-watch', args: 'band on' })
  for (const surface of SURFACES) {
    const shown = await $.ui.mount({ ...BAND, surface })
    expect(await shown.find({ type: 'Text', text: 'HOT' }), surface).toBeDefined()
    await shown.unmount()
  }
})

test('the buttons sit at the right end of the band: a growing Box stands between the text and the buttons, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const row = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.flexDirection === 'row' && b.children.some((c: any) => c.props?.flexGrow === 1))
    expect(row, surface).toBeDefined()
    const kids = row.children
    const grow = kids.findIndex((c: any) => c.props?.flexGrow === 1)
    // The growing Box is followed by the pane button and the hide button, in this order
    expect(kids.slice(grow + 1).map((c: any) => c.children[0].props.key), surface).toEqual(['pane', 'band-hide'])
    await ui.unmount()
  }
})

// The label of the band button after each step, on the terminal
async function paneLabel($: any): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const label = (await ui.findAll({ type: 'Button' })).find((b: any) => b.props.key === 'pane')?.props.label
  await ui.unmount()
  return label
}

test('a press closes a pane that another pane covers, so the label close always closes the pane', async ($, on) => {
  const h = harness(on, { paneShown: false })
  await start($)
  await step($, FABLE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pane' })
  await ui.unmount()
  expect(h.opened).toHaveLength(1)
  expect(await paneLabel($)).toBe('close')
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await again.press({ key: 'pane' })
  await again.unmount()
  expect(h.closed).toMatchObject([{ id: 'token-watch' }])
  expect(h.opened).toHaveLength(1)
  expect(await paneLabel($)).toBe('details')
})

test('a pane that waits for room reads close, says why in a toast, and the next press closes it', async ($, on) => {
  const h = harness(on, { openResult: { value: { isPlaced: false, reason: 'terminal too narrow' } } })
  await start($)
  await step($, FABLE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pane' })
  await ui.unmount()
  expect(h.toasts.at(-1)).toBe('The token-watch pane is waiting: terminal too narrow')
  expect(await paneLabel($)).toBe('close')
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await again.press({ key: 'pane' })
  await again.unmount()
  expect(h.closed).toMatchObject([{ id: 'token-watch' }])
  expect(await paneLabel($)).toBe('details')
})

test('a press of the band button says in a toast why the pane did not open', async ($, on) => {
  const h = harness(on, { openResult: { deny: 'no pane slot' } })
  await start($)
  await step($, FABLE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pane' })
  expect(h.toasts.at(-1)).toMatch(/^The token-watch pane did not open:/)
  expect(h.toasts.at(-1)).toContain('no pane slot')
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
  // The stub books the request in the session cost: $39.20 and $0.35 for the Fable request at the 1-hour price
  expect(await ui.find({ type: 'Text', text: /^\s*\$39\.55$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: RUNS_OUT })).toBeDefined()
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

// The dialog of /token-watch recommend, at the 80 columns that the mod asks for
const RECOMMEND = (surface: 'terminal' | 'desktop', columns = 80) => ({
  plugin: 'token-watch',
  component: 'Pane',
  requestId: 'token-watch-recommend',
  surface,
  viewport: { columns: 200, rows: 50 },
  props: { title: 'token-watch recommend', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const ESTIMATE = /^≈ [0-9.]+k? tokens, estimated from the length of the prompt$/
const USAGE_LINE = 'sonnet · input 2.4k · output 800 · ≈ $0.01 at API prices · counted in the Session tab under the scope recommend'

test('/token-watch recommend opens the cost dialog on both surfaces, and no model call runs before the confirmation', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  expect(await $.command.run({ command: 'token-watch', args: 'recommend' })).toEqual({})
  // A dialog: it takes the keys, Esc closes it, and the toasts wait
  expect(h.opened.at(-1)).toEqual({ id: 'token-watch-recommend', title: 'token-watch recommend', focus: true, closeOnEscape: true, holdToasts: true, columns: 80, rows: 18 })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(RECOMMEND(surface))
    expect(await ui.find({ type: 'Text', text: 'Ask sonnet for recommendations on this usage?' }), surface).toBeDefined()
    for (const label of ['model', 'input', 'output', 'highest cost', 'plan']) expect(await ui.find({ type: 'Text', text: label }), surface + ' ' + label).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ESTIMATE }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'up to 4.0k tokens' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^≈ \$0\.0[0-9]$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' at API prices of sonnet-5-5, with the full output cap' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'On a subscription the call counts against the plan allowance.' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^The prompt holds the data of the Session, Week and Why tabs/ }), surface).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'recommend-ask' }))?.props, surface).toMatchObject({ label: 'Ask sonnet', hotkey: 'a', variant: 'primary' })
    expect((await ui.find({ type: 'Button', key: 'recommend-cancel' }))?.props, surface).toMatchObject({ label: 'Cancel', hotkey: 'c' })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' }), surface).toBeUndefined()
    await ui.unmount()
  }
  expect(h.modelCalls).toHaveLength(0)
})

test('the dialog rows keep the label column and wrap the value in the room that is left, at 80 and at 45 columns', async ($, on) => {
  harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  for (const surface of SURFACES) {
    for (const columns of [80, 45]) {
      const ui = await $.ui.mount(RECOMMEND(surface, columns))
      const tree: any = await ui.drawn()
      const rows = tree.children.filter((c: any) => c.type === 'Box' && c.props.flexDirection === 'row' && c.children.length === 2 && c.children[0].props.width === 15)
      expect(rows, surface + ' ' + columns).toHaveLength(5)
      for (const row of rows) {
        expect(row.children[0].props.flexShrink).toBe(0)
        expect(row.children[1].props).toMatchObject({ flexShrink: 1, width: columns - 15 })
        expect(row.children[1].children[0].props.wrap).toBe('wrap')
      }
      await ui.unmount()
    }
  }
})

test('Ask runs one model call with the prompt and shows the reply as Markdown with its cost, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  let ui = await $.ui.mount(RECOMMEND('terminal'))
  const estimate = textOf(await ui.find({ type: 'Text', text: ESTIMATE }))
  await ui.press({ key: 'recommend-ask' })
  expect(h.modelCalls).toHaveLength(1)
  const request = h.modelCalls[0]
  expect(request).toMatchObject({ model: 'sonnet', system: RECOMMEND_SYSTEM, maxTokens: 4000, effort: 'medium', timeoutMs: 120_000 })
  expect(request.prompt).toContain('## This conversation, by model and scope\n- fable-5-1 main: 1 request')
  // The dialog showed the estimate of this prompt
  expect(estimate).toBe('≈ ' + formatTokens(estimateTokens(RECOMMEND_SYSTEM + request.prompt)) + ' tokens, estimated from the length of the prompt')
  // The pane stays open for the reply: it asks for more rows and no longer holds the toasts
  expect(h.opened.at(-1)).toEqual({ id: 'token-watch-recommend', title: 'token-watch recommend', closeOnEscape: true, columns: 80, rows: 24 })
  await ui.unmount()
  for (const surface of SURFACES) {
    ui = await $.ui.mount(RECOMMEND(surface))
    expect((await ui.find({ type: 'Markdown' }))?.props.text, surface).toBe(REPLY.text)
    expect(await ui.find({ type: 'Text', text: USAGE_LINE }), surface).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'recommend-ask' }), surface).toBeUndefined()
    await ui.unmount()
  }
})

test('two quick presses of Ask run one model call', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = harness(on, {
    modelResult: async () => {
      await gate
      return { value: REPLY }
    },
  })
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND('terminal'))
  // Both presses target the Ask that is drawn now. The second one finds the dialog in the phase asking, or no Ask at all
  const presses = [ui.press({ key: 'recommend-ask' }), ui.press({ key: 'recommend-ask' })]
  while (h.modelCalls.length === 0) await Promise.resolve()
  release()
  await Promise.allSettled(presses)
  expect(h.modelCalls).toHaveLength(1)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(REPLY.text)
})

test('a reply longer than 10000 characters, or with a carriage return, is cut and drawn on both surfaces', async ($, on) => {
  const long = '## Long\r\n\n' + 'word '.repeat(3_000)
  harness(on, { modelResult: { value: { ...REPLY, text: long } } })
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  let ui = await $.ui.mount(RECOMMEND('terminal'))
  await ui.press({ key: 'recommend-ask' })
  await ui.unmount()
  for (const surface of SURFACES) {
    // The mount fails when the surface refuses the tree, so a mounted dialog shows that the text fits
    ui = await $.ui.mount(RECOMMEND(surface))
    const text: string = (await ui.find({ type: 'Markdown' }))?.props.text
    expect(text.length, surface).toBeLessThanOrEqual(10_000)
    expect(text.startsWith('## Long\n\n'), surface).toBe(true)
    expect(text.endsWith('… (cut at 10,000 characters)'), surface).toBe(true)
    await ui.unmount()
  }
})

test('after the call, the Session tab shows its cost under the scope recommend, on both surfaces', async ($, on) => {
  harness(on)
  await start($)
  await step($, FABLE)
  await complete($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const dialog = await $.ui.mount(RECOMMEND('terminal'))
  await dialog.press({ key: 'recommend-ask' })
  await dialog.unmount()
  await $.command.run({ command: 'token-watch', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-2' })
    // The alias is priced as the newest Sonnet of the table, so the name has the mark of an estimate
    expect(await ui.find({ type: 'Text', text: /^sonnet ≈\s*$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^recommend\s+$/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+\$0\.01$/ }), surface).toBeDefined()
    await ui.unmount()
  }
})

test('Cancel closes the dialog without a model call, on both surfaces', async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    await $.command.run({ command: 'token-watch', args: 'recommend' })
    const ui = await $.ui.mount(RECOMMEND(surface))
    await ui.press({ key: 'recommend-cancel' })
    expect(h.closed.at(-1), surface).toMatchObject({ id: 'token-watch-recommend' })
    expect(await ui.find({ type: 'Button', key: 'recommend-ask' }), surface).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Run /token-watch recommend to ask for recommendations.' }), surface).toBeDefined()
    await ui.unmount()
  }
  // Esc closes the pane as the close mark does: the open asks for it, and the ui.close hook of the mod ends the dialog.
  // The test engine raises no ui.close of the person, so this test covers the button
  expect(h.opened.every((o: any) => o.closeOnEscape === true)).toBe(true)
  expect(h.modelCalls).toHaveLength(0)
})

test('a call without a reply shows the reason on both surfaces', async ($, on) => {
  harness(on, { modelResult: { value: { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  let ui = await $.ui.mount(RECOMMEND('terminal'))
  await ui.press({ key: 'recommend-ask' })
  await ui.unmount()
  for (const surface of SURFACES) {
    ui = await $.ui.mount(RECOMMEND(surface))
    expect(await ui.find({ type: 'Text', text: 'No recommendations' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'The API answered with an error: rate_limit (HTTP 429).' }), surface).toBeDefined()
    // A call that used no tokens has no usage line
    expect(await ui.find({ type: 'Text', text: /counted in the Session tab/ }), surface).toBeUndefined()
    await ui.unmount()
  }
})

test('a request that the engine refuses to send shows why', async ($, on) => {
  harness(on, { modelResult: { deny: 'model not allowed' } })
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND('terminal'))
  await ui.press({ key: 'recommend-ask' })
  expect(textOf(await ui.find({ type: 'Text', text: /^The request was not sent: / }))).toContain('model not allowed')
})

test('the option recommendModel sets the model of the dialog and of the call', { options: { recommendModel: 'opus' } }, async ($, on) => {
  const h = harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Ask opus for recommendations on this usage?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' at API prices of opus-5-5, with the full output cap' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'recommend-ask' }))?.props.label).toBe('Ask opus')
  await ui.press({ key: 'recommend-ask' })
  expect(h.modelCalls[0].model).toBe('opus')
})

test('a typed full model id goes to the call as typed, with its exact price and no mark', { options: { recommendModel: 'claude-opus-5-5' } }, async ($, on) => {
  const h = harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND('terminal'))
  expect(await ui.find({ type: 'Text', text: 'Ask claude-opus-5-5 for recommendations on this usage?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$0\.0[0-9]$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' at API prices of opus-5-5, with the full output cap' })).toBeDefined()
  await ui.press({ key: 'recommend-ask' })
  expect(h.modelCalls[0].model).toBe('claude-opus-5-5')
})

// The cache life: the band reads it from the cost that the stub books for each request, as Claude Code books it.
// The weekly limit of the harness runs out before its reset, so the action slow down takes the place of the re-warm price; a cold cache keeps it

test('the band counts down 5 minutes when Claude Code books the request at the 5-minute price', async ($, on) => {
  const h = harness(on, { booking: { main: '5m' } })
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(3 * MIN)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'WARM' })).toBeDefined()
  // The re-warm cost uses the 5-minute write price: 411k at 12.5 per million
  expect(await ui.find({ type: 'Text', text: ' 2m left · 411k cached' })).toBeDefined()
  await ui.unmount()
  await h.clock.advance(3 * MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 1m · next message re-writes 411k ≈ $5.14' })).toBeDefined()
})

test('the band shows no countdown when the booked cost fits no cache life, and COLD after 1 hour', async ($, on) => {
  const h = harness(on, { booking: { main: 'other' } })
  await start($)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(13 * MIN)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'cache life unknown · last request 13m ago · 411k cached' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'HOT' })).toBeUndefined()
  await ui.unmount()
  // After the longest life the cache is cold for both lives. The re-warm cost uses the default of the main conversation, 1 hour
  await h.clock.advance(62 * MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 15m · next message re-writes 411k ≈ $8.22' })).toBeDefined()
})

test('one booking at another cache life changes nothing, and a second one in a row changes the life', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  h.booking.main = '5m'
  await h.clock.advance(MIN)
  await step($, FABLE)
  await complete($)
  await h.clock.advance(MIN)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 59m left · 411k cached' })).toBeDefined()
  await ui.unmount()
  await step($, FABLE)
  await complete($)
  await h.clock.advance(MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 4m left · 411k cached' })).toBeDefined()
})

test('a cost that another request books inside the window fits no cache life', async ($, on) => {
  const h = harness(on)
  await start($)
  h.ledger.during = 0.01
  await step($, FABLE)
  await complete($)
  await h.clock.advance(MIN)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'cache life unknown · last request 1m ago · 411k cached' })).toBeDefined()
  await ui.unmount()
  // A cost booked before a request starts does not count for it
  h.ledger.usd += 0.01
  await step($, FABLE)
  await complete($)
  await h.clock.advance(MIN)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 59m left · 411k cached' })).toBeDefined()
})

test('a resumed conversation proves the cache life when Claude Code says the cache is warm or expired', async ($, on) => {
  harness(on)
  await start($)
  const resume = { source: 'resume', context_tokens: 380_000, model: 'claude-opus-5-5' } as const
  // Warm after 10 minutes: the life is 1 hour
  await $.classic.SessionStart({ ...resume, seconds_since_last_response: 600, prompt_cache_likely_expired: false })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 50m left · 380k cached' })).toBeDefined()
  await ui.unmount()
  // Expired after 10 minutes: the life is 5 minutes
  await $.classic.SessionStart({ ...resume, seconds_since_last_response: 600, prompt_cache_likely_expired: true })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'COLD' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 5m · next message re-writes 380k ≈ $1.90' })).toBeDefined()
  await ui.unmount()
  // Warm after 2 minutes: both lives fit
  await $.classic.SessionStart({ ...resume, seconds_since_last_response: 120, prompt_cache_likely_expired: false })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'cache life unknown · last request 2m ago · 380k cached' })).toBeDefined()
})

test('the cache life that Claude Code names at a model switch counts from the next request', async ($, on) => {
  const h = harness(on, { booking: { main: 'other' } })
  await start($)
  await step($, FABLE)
  await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-fable-5-1', requested_model: 'fable', source: 'command', context_tokens: 411_002, prompt_cache_warm: true, cache_ttl: '5m', estimated_cache_write_usd: 5.14, pricing: 'catalog' })
  await step($, FABLE)
  await complete($)
  await h.clock.advance(MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' 4m left · 411k cached' })).toBeDefined()
})

test('a request that neither reads nor writes the cache leaves the tube as it was', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await h.clock.advance(10 * MIN)
  await step($, { model: 'claude-fable-5-1', input_tokens: 500, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await complete($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ 50m left · / })).toBeDefined()
})

// The share of the resume row in the cause table of tab 2
async function resumeShare($: any): Promise<string> {
  await $.command.run({ command: 'token-watch', args: '' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-2' })
  const tableRows = (await pane.findAll({ type: 'Box' })).filter((b: any) => b.props.flexDirection === 'row' && b.props.width === undefined)
  const rows = tableRows.filter((b: any) => /^resume\s+$/.test(textOf(b.children[0])))
  return textOf(rows[0].children[4])
}

test('a pause longer than a 5-minute cache life makes the next cache write a resume', async ($, on) => {
  const h = harness(on, { booking: { main: '5m' } })
  await start($)
  await step($, FABLE)
  await h.clock.advance(6 * MIN)
  await step($, FABLE)
  await complete($)
  expect(await resumeShare($)).toBe('   50%')
})

test('the pause counts against the life of the cache that the previous request left', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  // The first booking at 5 minutes waits for a second one, so this request still writes with 1 hour
  h.booking.main = '5m'
  await step($, FABLE)
  await h.clock.advance(10 * MIN)
  // This request confirms 5 minutes, but the cache that it reads has the life of the request before: 1 hour, so the pause is no resume
  await step($, FABLE)
  await complete($)
  expect(await resumeShare($)).toBe('    0%')
})

test('with an API key the band shows the spend from the first response on, and no spend before it, on both surfaces', async ($, on) => {
  const h = harness(on, { rateLimits: [] })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^today / }), surface).toBeUndefined()
    await ui.unmount()
  }
  await step($, SONNET)
  await complete($)
  await h.clock.advance(15_000)
  await h.clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const { text } = await bandLine(ui, surface)
    expect(text, surface).toMatch(/\| today \$\d+\.\d\d · \$\d+\.\d\d\/h$/)
    expect(text, surface).not.toContain('week')
    await ui.unmount()
  }
})
