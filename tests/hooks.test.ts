import { expect, test } from 'claude-code/testing'
import { costOf } from '../hooks/prices'
import { REPLY_USAGE } from './helpers'
import { FABLE, MIN, RESETS_AT, SONNET, T0, complete, end, harness, snapshotIn, spawn, start, step, type Failures } from './helpers'

const OLD = { v: 1, key: 'run:old:1', sessionId: 'old', repo: 'x', model: 'm', updatedAt: T0 - 9 * 24 * 60 * MIN, lastMainRequestAt: null, contextTokens: 0, isWorking: false, readings: [], hours: {} }
const RECENT = { ...OLD, key: 'run:recent:1', sessionId: 'recent', updatedAt: T0 - 24 * 60 * MIN }

test('session start registers the command, deletes old and bad snapshots and reads the limits', async ($, on) => {
  const h = harness(on, { store: { 'run:old:1': OLD, 'run:recent:1': RECENT, 'run:bad:1': 'garbage', 'other-key': 1 } })
  await start($)
  expect(h.registered[0]).toMatchObject({ name: 'token-watch', immediate: true, argumentHint: '[recommend | band on | band off]' })
  await h.clock.advance(5_000)
  await h.clock.settle()
  expect(h.store.has('run:old:1')).toBe(false)
  expect(h.store.has('run:bad:1')).toBe(false)
  expect(h.store.has('run:recent:1')).toBe(true)
  expect(h.store.has('other-key')).toBe(true)
  await step($, FABLE)
  await end($)
  const snap = snapshotIn(h.store)
  expect(snap.key).toBe('run:sess-1:' + T0)
  expect(snap.repo).toBe('webshop')
  expect(snap.readings.map((r: any) => r.kind + ' ' + r.percentUsed)).toEqual(['seven_day 41'])
})

test('the clean-up of old snapshots waits 5 seconds after the start', async ($, on) => {
  const h = harness(on, { store: { 'run:old:1': OLD } })
  await start($)
  expect(h.store.has('run:old:1')).toBe(true)
  await h.clock.advance(5_000)
  await h.clock.settle()
  expect(h.store.has('run:old:1')).toBe(false)
})

test('a conversation without a request writes no key', async ($, on) => {
  const h = harness(on)
  await start($)
  await end($)
  expect([...h.store.keys()].filter((k) => k.startsWith('run:sess-1:'))).toEqual([])
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect([...h.store.keys()].filter((k) => k.startsWith('run:sess-1:'))).toEqual([])
})

test('requests of the main conversation and of a subagent go into the hourly buckets by model and scope', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  const spawned = await spawn($, 'Explore')
  expect(spawned).toEqual({ model: 'claude-sonnet-5-5', agentId: 'agent-Explore' })
  await step($, SONNET, 'agent-Explore')
  await end($)
  const hour = snapshotIn(h.store).hours['2026-10-06T12']
  expect(hour['claude-fable-5-1|main']).toEqual({ input: 2, output: 1000, cacheRead: 400_000, cacheWrite: 10_000, requests: 1, cost: costOf(FABLE, '1h') })
  expect(hour['claude-sonnet-5-5|Explore'].cost).toBe(costOf(SONNET, '5m'))
})

test('a request of a model without an exact price is counted with the price of the newest model of its family', async ($, on) => {
  const h = harness(on)
  await start($)
  const NEW_OPUS = { model: 'claude-opus-5-6', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }
  await step($, NEW_OPUS)
  await end($)
  const cell = snapshotIn(h.store).hours['2026-10-06T12']['claude-opus-5-6|main']
  // claude-opus-5-5: input 4 and 1-hour write 8 per million tokens
  expect(cell.cost).toBe(12)
  expect(cell.cost).toBe(costOf(NEW_OPUS, '1h'))
})

test('a subagent request without a known type counts under the scope subagent', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, SONNET, 'agent-unknown')
  await end($)
  expect(Object.keys(snapshotIn(h.store).hours['2026-10-06T12'])).toEqual(['claude-sonnet-5-5|subagent'])
})

test('the request result passes through unchanged, and a result without usage adds nothing', async ($, on) => {
  const h = harness(on)
  await start($)
  const withUsage = await step($, FABLE)
  expect(withUsage).toEqual({ turnId: 't', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: FABLE })
  const without = await step($, null)
  expect(without.usage).toBeNull()
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-fable-5-1|main'].requests).toBe(1)
})

test('the snapshot holds the last main request, the context and the working flag', async ($, on) => {
  const h = harness(on)
  await start($)
  await h.clock.advance(2 * MIN)
  await step($, FABLE)
  await end($)
  let snap = snapshotIn(h.store)
  expect(snap.lastMainRequestAt).toBe(T0 + 2 * MIN)
  expect(snap.contextTokens).toBe(411_002)
  expect(snap.model).toBe('claude-fable-5-1')
  expect(snap.isWorking).toBe(true)
  await complete($)
  await end($)
  snap = snapshotIn(h.store)
  expect(snap.isWorking).toBe(false)
})

test('a subagent turn end does not clear the working flag of the main conversation', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await complete($, 'agent-Explore')
  await end($)
  expect(snapshotIn(h.store).isWorking).toBe(true)
})

test('session.measure adds a reading when a percent moves a whole point', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [{ kind: 'seven_day', percentUsed: 42, resetsAt: RESETS_AT }], changed: ['rateLimits'] })
  await step($, FABLE)
  await end($)
  expect(snapshotIn(h.store).readings.map((r: any) => r.percentUsed)).toEqual([41, 42])
})

test('session.measure with the same percent moves the seenAt of the weekly reading in the snapshot', async ($, on) => {
  const h = harness(on)
  await start($)
  await h.clock.advance(30 * MIN)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 41.6, resetsAt: RESETS_AT }], changed: ['context'] })
  await step($, FABLE)
  await end($)
  const [reading] = snapshotIn(h.store).readings
  expect(reading.percentUsed).toBe(41)
  expect(reading.at).toBe(T0)
  expect(reading.seenAt).toBe(T0 + 30 * MIN)
})

test('the 15-second tick writes the snapshot when there is new data', async ($, on) => {
  const h = harness(on)
  await start($)
  h.store.clear()
  await step($, FABLE)
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(snapshotIn(h.store)).toBeDefined()
})

test('a failed store write reaches no hook result, and the request result stays unchanged', async ($, on) => {
  harness(on, { failStoreSet: true })
  await start($)
  const result = await step($, FABLE)
  expect(result.usage).toEqual(FABLE)
  await end($)
})

test('a new conversation after /clear writes a new key', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await end($)
  await h.clock.advance(5 * MIN)
  await $.classic.SessionStart({ source: 'clear' })
  await step($, FABLE)
  await end($)
  expect([...h.store.keys()].filter((k) => k.startsWith('run:sess-1:')).sort()).toEqual(['run:sess-1:' + T0, 'run:sess-1:' + (T0 + 5 * MIN)])
  const second = h.store.get('run:sess-1:' + (T0 + 5 * MIN)) as any
  expect(second.hours['2026-10-06T12']['claude-fable-5-1|main'].requests).toBe(1)
  expect(second.readings.map((r: any) => r.kind + ' ' + r.percentUsed)).toEqual(['seven_day 41'])
})

test('a failure in the /clear hook does not stop the session start, and the next request still counts', async ($, on) => {
  const fail: Failures = {}
  const h = harness(on, { fail })
  await start($)
  fail.sessionId = true
  await expect($.classic.SessionStart({ source: 'clear' })).resolves.toBeDefined()
  fail.sessionId = false
  await step($, FABLE)
  await end($)
  const snapshot = snapshotIn(h.store)
  expect(snapshot.hours['2026-10-06T12']['claude-fable-5-1|main'].requests).toBe(1)
})

test('a subagent request counts under the scope subagent when the agent list fails, and under its type once the list answers', async ($, on) => {
  const fail: Failures = { agentList: true }
  const h = harness(on, { fail })
  await start($)
  const spawned = await spawn($, 'Explore')
  await step($, SONNET, spawned.agentId)
  fail.agentList = false
  await step($, SONNET, spawned.agentId)
  await end($)
  const hour = snapshotIn(h.store).hours['2026-10-06T12']
  expect(hour['claude-sonnet-5-5|subagent'].requests).toBe(1)
  expect(hour['claude-sonnet-5-5|Explore'].requests).toBe(1)
})

test('the type of a subagent is read from the agent list once and then kept', async ($, on) => {
  const h = harness(on)
  await start($)
  await spawn($, 'Plan')
  await step($, SONNET, 'agent-Plan')
  await step($, SONNET, 'agent-Plan')
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-sonnet-5-5|Plan'].requests).toBe(2)
  expect(h.agentListCalls.count).toBe(1)
})

test('an agent that the list does not hold counts under the scope subagent, and the list is read once', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, SONNET, 'agent-of-a-workflow')
  await step($, SONNET, 'agent-of-a-workflow')
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-sonnet-5-5|subagent'].requests).toBe(2)
  expect(h.agentListCalls.count).toBe(1)
})

const PANE = {
  plugin: 'token-watch',
  component: 'Pane',
  requestId: 'token-watch',
  surface: 'terminal',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'token-watch', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the tick reads the other conversations only while the pane shows tab 1 or 3', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await h.clock.advance(15_000)
  await h.clock.settle()
  // No pane yet: the tick does not list the store
  const closed = h.keyCalls.count
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(h.keyCalls.count).toBe(closed)
  await $.command.run({ command: 'token-watch', args: '' })
  const ui = await $.ui.mount(PANE)
  const opened = h.keyCalls.count
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(h.keyCalls.count).toBeGreaterThan(opened)
  await ui.press({ key: 'tab-2' })
  const onSession = h.keyCalls.count
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(h.keyCalls.count).toBe(onSession)
  await ui.press({ key: 'tab-3' })
  const onWeek = h.keyCalls.count
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(h.keyCalls.count).toBeGreaterThan(onWeek)
  // Tab 5 is static text: opening it and the tick list no key
  await ui.press({ key: 'tab-5' })
  const onHelp = h.keyCalls.count
  await h.clock.advance(15_000)
  await h.clock.settle()
  expect(h.keyCalls.count).toBe(onHelp)
})

test('a refused pane open does not throw into the session', async ($, on) => {
  harness(on, { denyOpen: true })
  await start($)
  const answer = (await $.command.run({ command: 'token-watch', args: '' })) as { text?: string }
  expect(answer.text).toMatch(/^The token-watch pane did not open:/)
})

// The dialog of /token-watch recommend, for a press on its buttons
const RECOMMEND_PANE = {
  plugin: 'token-watch',
  component: 'Pane',
  requestId: 'token-watch-recommend',
  surface: 'terminal',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'token-watch recommend', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

async function ask($: any): Promise<void> {
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND_PANE)
  await ui.press({ key: 'recommend-ask' })
  await ui.unmount()
}

test('the usage of the call goes into the hours of the snapshot under the scope recommend, with its cost', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  await ask($)
  await end($)
  const hour = snapshotIn(h.store).hours['2026-10-06T12']
  const usage = { model: 'claude-sonnet', ...REPLY_USAGE }
  // The call has no cache of a conversation: a cache write would have the 5-minute price, as in a subagent
  expect(hour['claude-sonnet|recommend']).toEqual({ input: 2_400, output: 800, cacheRead: 0, cacheWrite: 0, requests: 1, cost: costOf(usage, '5m') })
  expect(hour['claude-sonnet|recommend'].cost).toBeGreaterThan(0)
  expect(hour['claude-fable-5-1|main'].requests).toBe(1)
})

test('a call without a reply counts the tokens it used, and a call that used none counts nothing', async ($, on) => {
  const used = { input_tokens: 2_400, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let h = harness(on, { modelResult: { value: { isAnswered: false, reason: 'empty-reply', usage: used } } })
  await start($)
  await step($, FABLE)
  await ask($)
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-sonnet|recommend']).toMatchObject({ input: 2_400, output: 50, requests: 1 })
})

test('a call that used no tokens adds no row', async ($, on) => {
  const h = harness(on, { modelResult: { value: { isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })
  await start($)
  await step($, FABLE)
  await ask($)
  await end($)
  expect(Object.keys(snapshotIn(h.store).hours['2026-10-06T12'])).toEqual(['claude-fable-5-1|main'])
})

test('Cancel while the call runs drops the reply, and the tokens of the call still count', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = harness(on, {
    modelResult: async () => {
      await gate
      return { value: { isAnswered: false, reason: 'aborted', usage: { input_tokens: 2_400, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    },
  })
  await start($)
  await step($, FABLE)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND_PANE)
  const asking = ui.press({ key: 'recommend-ask' })
  // The call runs: the dialog says so and offers Cancel
  while (h.modelCalls.length === 0) await Promise.resolve()
  expect(await ui.find({ type: 'Text', text: 'Asking sonnet…' })).toBeDefined()
  await ui.press({ key: 'recommend-cancel' })
  release()
  await asking
  expect(await ui.find({ type: 'Text', text: 'Run /token-watch recommend to ask for recommendations.' })).toBeDefined()
  await ui.unmount()
  await end($)
  expect(h.modelCalls).toHaveLength(1)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-sonnet|recommend']).toMatchObject({ input: 2_400, output: 0, requests: 1 })
})

test('a reload of the module while the call runs turns the dialog from asking into a message', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = harness(on, {
    modelResult: async () => {
      await gate
      return { value: { isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    },
  })
  await start($)
  await $.command.run({ command: 'token-watch', args: 'recommend' })
  const ui = await $.ui.mount(RECOMMEND_PANE)
  const asking = ui.press({ key: 'recommend-ask' })
  while (h.modelCalls.length === 0) await Promise.resolve()
  expect(await ui.find({ type: 'Text', text: 'Asking sonnet…' })).toBeDefined()
  // A reload runs session.start again
  await start($)
  expect(await ui.find({ type: 'Text', text: 'The call stopped: the mod loaded again while the call ran. Run /token-watch recommend again.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Asking sonnet…' })).toBeUndefined()
  release()
  await asking
})

const BAND_OFF = 'Band off in all sessions on this Mac. The mod still counts. /token-watch band on shows it again.'

test('band off and band on write the setting of all sessions to the store and answer with a toast, not with text', async ($, on) => {
  const h = harness(on)
  await start($)
  expect(await $.command.run({ command: 'token-watch', args: 'band off' })).toEqual({})
  expect(h.store.get('settings')).toEqual({ band: 'off' })
  expect(h.toasts.at(-1)).toBe(BAND_OFF)
  // Case and spaces do not matter
  expect(await $.command.run({ command: 'token-watch', args: ' Band  ON ' })).toEqual({})
  expect(h.store.get('settings')).toEqual({ band: 'on' })
  expect(h.toasts.at(-1)).toBe('Band on in all sessions on this Mac.')
  // The band setting opens no pane
  expect(h.opened).toEqual([])
})

test('band without on or off names the state in a toast', async ($, on) => {
  const h = harness(on, { store: { settings: { band: 'off' } } })
  await start($)
  expect(await $.command.run({ command: 'token-watch', args: 'band' })).toEqual({})
  expect(h.toasts.at(-1)).toBe('The band is off. /token-watch band on shows it.')
  await $.command.run({ command: 'token-watch', args: 'band on' })
  await $.command.run({ command: 'token-watch', args: 'band' })
  expect(h.toasts.at(-1)).toBe('The band is on. /token-watch band off hides it.')
})

test('the setting keeps the other values of the settings key, and the clean-up and the list of the other sessions leave the key alone', async ($, on) => {
  const h = harness(on, { store: { settings: { band: 'off', other: 1 } } })
  await start($)
  await h.clock.advance(5_000)
  await h.clock.settle()
  expect(h.store.get('settings')).toEqual({ band: 'off', other: 1 })
  await $.command.run({ command: 'token-watch', args: 'band on' })
  expect(h.store.get('settings')).toEqual({ band: 'on', other: 1 })
  await $.command.run({ command: 'token-watch', args: '' })
  expect(h.store.has('settings')).toBe(true)
})

test('a failed write of the setting changes nothing and says why in a toast', async ($, on) => {
  const h = harness(on, { failStoreSet: true })
  await start($)
  expect(await $.command.run({ command: 'token-watch', args: 'band off' })).toEqual({})
  expect(h.store.has('settings')).toBe(false)
  expect(h.toasts.at(-1)).toMatch(/^The band setting was not saved: /)
  await $.command.run({ command: 'token-watch', args: 'band' })
  expect(h.toasts.at(-1)).toBe('The band is on. /token-watch band off hides it.')
})

test('with the band off the mod still counts each request and writes the snapshot', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.command.run({ command: 'token-watch', args: 'band off' })
  await step($, FABLE)
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-fable-5-1|main'].requests).toBe(1)
})

test('the command closes the pane when it shows, and opens it again after that', async ($, on) => {
  const h = harness(on)
  await start($)
  expect(await $.command.run({ command: 'token-watch', args: '' })).toEqual({})
  expect(h.opened).toHaveLength(1)
  expect(await $.command.run({ command: 'token-watch', args: '' })).toEqual({})
  expect(h.closed).toMatchObject([{ id: 'token-watch' }])
  expect(h.opened).toHaveLength(1)
  await $.command.run({ command: 'token-watch', args: '' })
  expect(h.opened).toHaveLength(2)
})

test('band on shows a band that the × hid in this session, also when the store write fails', async ($, on) => {
  const h = harness(on, { failStoreSet: true })
  await start($)
  await step($, FABLE)
  const ui = await $.ui.mount({ plugin: 'token-watch', component: 'AbovePrompt', viewport: { columns: 160, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 160, scroll: { offset: 0, bodyRows: 5 }, view: {} }, surface: 'terminal' })
  await ui.press({ key: 'band-hide' })
  await ui.unmount()
  await $.command.run({ command: 'token-watch', args: 'band' })
  expect(h.toasts.at(-1)).toBe('The band is hidden in this session. /token-watch band on shows it.')
  await $.command.run({ command: 'token-watch', args: 'band on' })
  expect(h.toasts.at(-1)).toMatch(/^The band setting was not saved: /)
  await $.command.run({ command: 'token-watch', args: 'band' })
  expect(h.toasts.at(-1)).toBe('The band is on. /token-watch band off hides it.')
})

test('a request that Claude Code books at the 5-minute price costs that price, and the snapshot carries the cache life', async ($, on) => {
  const h = harness(on, { booking: { main: '5m' } })
  await start($)
  await step($, FABLE)
  await end($)
  const snap = snapshotIn(h.store)
  expect(snap.hours['2026-10-06T12']['claude-fable-5-1|main'].cost).toBe(costOf(FABLE, '5m'))
  expect(snap.mainTtl).toBe('5m')
})

test('a booked cost that fits no cache life keeps the default price and an unknown cache life', async ($, on) => {
  const h = harness(on, { booking: { main: 'other' } })
  await start($)
  await step($, FABLE)
  await end($)
  const snap = snapshotIn(h.store)
  expect(snap.hours['2026-10-06T12']['claude-fable-5-1|main'].cost).toBe(costOf(FABLE, '1h'))
  expect(snap.mainTtl).toBeNull()
})

test('a subagent whose requests Claude Code books at the 1-hour price costs that price', async ($, on) => {
  const h = harness(on, { booking: { subagent: '1h' } })
  await start($)
  await spawn($, 'Explore')
  await step($, SONNET, 'agent-Explore')
  await end($)
  expect(snapshotIn(h.store).hours['2026-10-06T12']['claude-sonnet-5-5|Explore'].cost).toBe(costOf(SONNET, '1h'))
})

test('a session cost that falls while a request runs matches no cache life, and the count starts over from there', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($, FABLE)
  h.booking.main = '5m'
  // The count of the session cost starts again while the request runs: its reading is lower than the one before, so it matches nothing
  h.ledger.during = -h.ledger.usd
  await step($, FABLE)
  // The first 5-minute match after the drop waits for a second one
  await step($, FABLE)
  await end($)
  expect(snapshotIn(h.store).mainTtl).toBe('1h')
  await step($, FABLE)
  await end($)
  expect(snapshotIn(h.store).mainTtl).toBe('5m')
})
