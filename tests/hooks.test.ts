import { expect, test } from 'claude-code/testing'
import { costOf } from '../hooks/prices'
import { FABLE, MIN, RESETS_AT, SONNET, T0, complete, end, harness, snapshotIn, spawn, start, step, type Failures } from './helpers'

const OLD = { v: 1, key: 'run:old:1', sessionId: 'old', repo: 'x', model: 'm', updatedAt: T0 - 9 * 24 * 60 * MIN, lastMainRequestAt: null, contextTokens: 0, isWorking: false, readings: [], hours: {} }
const RECENT = { ...OLD, key: 'run:recent:1', sessionId: 'recent', updatedAt: T0 - 24 * 60 * MIN }

test('session start registers the command, deletes old and bad snapshots and reads the limits', async ($, on) => {
  const h = harness(on, { store: { 'run:old:1': OLD, 'run:recent:1': RECENT, 'run:bad:1': 'garbage', 'other-key': 1 } })
  await start($)
  expect(h.registered[0]).toMatchObject({ name: 'token-watch', immediate: true })
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
  expect(hour['claude-fable-5-1|main']).toEqual({ input: 2, output: 1000, cacheRead: 400_000, cacheWrite: 10_000, requests: 1, cost: costOf(FABLE, false) })
  expect(hour['claude-sonnet-5-5|Explore'].cost).toBe(costOf(SONNET, true))
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
  expect(cell.cost).toBe(costOf(NEW_OPUS, false))
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

test('a failed record of the subagent type keeps the spawn result unchanged', async ($, on) => {
  const fail: Failures = { agentsState: true }
  harness(on, { fail })
  await start($)
  const spawned = await spawn($, 'Explore')
  expect(spawned.agentId).toBe('agent-Explore')
  expect(spawned.model).toBe('claude-sonnet-5-5')
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
