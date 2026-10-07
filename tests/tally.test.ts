import { expect, test } from 'claude-code/testing'
import {
  DAY_MS,
  EMPTY,
  HOUR_MS,
  NO_CAUSES,
  NO_MAIN,
  addCause,
  addReadings,
  addTo,
  breakdownOf,
  causeOf,
  contextOf,
  countsOf,
  groupWeek,
  hourKey,
  last60,
  mainAfter,
  mergeReadings,
  modelSums,
  nowRows,
  parseSnapshot,
  pruneHours,
  rowsOf,
  runKey,
  snapshotOf,
  sumAll,
  today,
  weekOf,
} from '../hooks/tally'

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
const MIN = 60_000
const FABLE = { model: 'claude-fable-5-1', input_tokens: 2, output_tokens: 1000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 10_000 }
const RUN = { sessionId: 'sess-1', startedAt: T0, repo: 'webshop' }

function counts(cost: number) {
  return { ...EMPTY, requests: 1, cost }
}

function snap(over: Record<string, unknown>) {
  return { v: 1, key: 'run:a:1', sessionId: 'a', repo: 'webshop', model: 'claude-fable-5-1', updatedAt: T0, lastMainRequestAt: T0, contextTokens: 1000, isWorking: false, readings: [], hours: {}, ...over }
}

test('countsOf and addTo add a request without changing the input', async () => {
  const c = countsOf(FABLE, 3)
  expect(c).toEqual({ input: 2, output: 1000, cacheRead: 400_000, cacheWrite: 10_000, requests: 1, cost: 3 })
  const once = addTo({}, 'claude-fable-5-1', 'main', c)
  const before = JSON.stringify(once)
  const twice = addTo(once, 'claude-fable-5-1', 'main', c)
  expect(JSON.stringify(once)).toBe(before)
  expect(twice['claude-fable-5-1'].main.requests).toBe(2)
  expect(twice['claude-fable-5-1'].main.cacheRead).toBe(800_000)
  expect(contextOf(c)).toBe(411_002)
})

test('causeOf classifies start, growth and resume', async () => {
  expect(causeOf(undefined, T0, 60 * MIN)).toBe('start')
  expect(causeOf(T0, T0 + 10 * MIN, 60 * MIN)).toBe('growth')
  expect(causeOf(T0, T0 + 61 * MIN, 60 * MIN)).toBe('resume')
  expect(causeOf(T0, T0 + 6 * MIN, 5 * MIN)).toBe('resume')
  const c = addCause(NO_CAUSES, 'resume', 380_000, 7.6)
  expect(c.resume).toEqual({ tokens: 380_000, cost: 7.6 })
  expect(c.start).toEqual({ tokens: 0, cost: 0 })
})

test('mainAfter keeps 4 hours of request times and records a resume', async () => {
  const first = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0.2)
  const second = mainAfter(first, 'claude-fable-5-1', T0 + 300 * MIN, 420_000, 'resume', 7.6)
  expect(second.lastRequestAt).toBe(T0 + 300 * MIN)
  expect(second.contextTokens).toBe(420_000)
  expect(second.requestTimes).toEqual([T0 + 300 * MIN])
  expect(second.resumes).toEqual([{ at: T0 + 300 * MIN, cost: 7.6 }])
})

test('hourKey and pruneHours use UTC hours and keep 8 days', async () => {
  expect(hourKey(T0 + 59 * MIN)).toBe('2026-10-06T12')
  const hours = { '2026-10-06T12': { 'm|main': counts(1) }, '2026-09-27T12': { 'm|main': counts(1) } }
  expect(Object.keys(pruneHours(hours, T0))).toEqual(['2026-10-06T12'])
})

test('addReadings adds a reading only when a percent moves a whole point or the reset changes', async () => {
  let r = addReadings([], [{ kind: 'seven_day', percentUsed: 41, resetsAt: 'x' }], T0)
  r = addReadings(r, [{ kind: 'seven_day', percentUsed: 41.5, resetsAt: 'x' }], T0 + MIN)
  r = addReadings(r, [{ kind: 'seven_day', percentUsed: 42, resetsAt: 'x' }], T0 + 2 * MIN)
  r = addReadings(r, [{ kind: 'seven_day', percentUsed: 42, resetsAt: 'y' }], T0 + 3 * MIN)
  expect(r.map((x) => x.percentUsed)).toEqual([41, 42, 42])
  const many = Array.from({ length: 500 }, (_, i) => ({ at: i, kind: 'k' + i, percentUsed: 1 }))
  expect(addReadings(many, [], T0).length).toBe(400)
})

test('rowsOf puts main first, and the sums add up', async () => {
  let t = addTo({}, 'claude-opus-5-5', 'Explore', counts(1))
  t = addTo(t, 'claude-opus-5-5', 'main', counts(2))
  t = addTo(t, 'claude-sonnet-5-5', 'general-purpose', counts(4))
  expect(rowsOf(t).map((r) => r.model + '/' + r.scope)).toEqual(['claude-opus-5-5/main', 'claude-opus-5-5/Explore', 'claude-sonnet-5-5/general-purpose'])
  expect(sumAll(t).cost).toBe(7)
  expect(modelSums(t).map((m) => m.counts.cost)).toEqual([3, 4])
})

test('snapshotOf and parseSnapshot round-trip, and parseSnapshot refuses bad values', async () => {
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0)
  const s = snapshotOf(RUN, main, [], { '2026-10-06T12': { 'claude-fable-5-1|main': counts(1) } }, T0)
  expect(s.key).toBe(runKey(RUN))
  expect(s.key).toBe('run:sess-1:' + T0)
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
  expect(parseSnapshot(null)).toBeNull()
  expect(parseSnapshot('text')).toBeNull()
  expect(parseSnapshot({ ...s, v: 2 })).toBeNull()
  expect(parseSnapshot({ ...s, updatedAt: 'x' })).toBeNull()
  expect(parseSnapshot({ ...s, hours: [] })).toBeNull()
})

test('snapshotOf keeps only the seven_day readings of the last 8 days', async () => {
  const main = mainAfter(NO_MAIN, 'claude-fable-5-1', T0, 411_002, 'start', 0)
  const readings = [
    { at: T0 - 9 * DAY_MS, kind: 'seven_day', percentUsed: 10 },
    { at: T0 - 60 * MIN, kind: 'seven_day', percentUsed: 41 },
    { at: T0 - 60 * MIN, kind: 'five_hour', percentUsed: 12 },
    { at: T0 - 60 * MIN, kind: 'spend_limit', percentUsed: 3 },
  ]
  expect(snapshotOf(RUN, main, readings, {}, T0).readings).toEqual([{ at: T0 - 60 * MIN, kind: 'seven_day', percentUsed: 41 }])
})

test('last60 adds the current hour and the inside part of the previous hour', async () => {
  const hours = { '2026-10-06T11': { 'm|main': counts(4) }, '2026-10-06T12': { 'm|main': counts(1) } }
  expect(last60(hours, T0 + 15 * MIN)).toBe(1 + 4 * 0.75)
})

test('today sums since local midnight', async () => {
  const now = new Date(2026, 9, 6, 15, 30).getTime()
  const midnight = new Date(2026, 9, 6, 0, 0).getTime()
  const hours = { [hourKey(midnight - HOUR_MS)]: { 'm|main': counts(5) }, [hourKey(midnight)]: { 'm|main': counts(2) }, [hourKey(now)]: { 'm|main': counts(3) } }
  expect(today(hours, now)).toBe(5)
})

test('nowRows keeps the newest run of a session, drops old ones and sorts by the last 60 minutes', async () => {
  const hot = { [hourKey(T0)]: { 'm|main': counts(6) } }
  const list = [
    snap({ key: 'run:a:1', sessionId: 'a', updatedAt: T0 - 2 * HOUR_MS }),
    snap({ key: 'run:a:2', sessionId: 'a', updatedAt: T0, hours: hot }),
    snap({ key: 'run:b:1', sessionId: 'b', repo: 'mobile-frontend', updatedAt: T0 - 2 * DAY_MS }),
    snap({ key: 'run:c:1', sessionId: 'c', repo: 'docs-portal', updatedAt: T0 - MIN }),
  ]
  const rows = nowRows(list as never, 'run:c:1', T0 + 10 * MIN)
  expect(rows.map((r) => r.key)).toEqual(['run:a:2', 'run:c:1'])
  expect(rows[1].isCurrent).toBe(true)
})

test('nowRows shows a working session as not working after 10 minutes without a write', async () => {
  const list = [snap({ key: 'run:a:1', isWorking: true, updatedAt: T0 })]
  expect(nowRows(list as never, '', T0 + 5 * MIN)[0].isWorking).toBe(true)
  expect(nowRows(list as never, '', T0 + 10 * MIN)[0].isWorking).toBe(true)
  expect(nowRows(list as never, '', T0 + 11 * MIN)[0].isWorking).toBe(false)
})

test('weekOf uses the latest weekly reading', async () => {
  const resetsAt = new Date(T0 + 5 * DAY_MS).toISOString()
  const w = weekOf([{ at: T0 - MIN, kind: 'seven_day', percentUsed: 40, resetsAt }, { at: T0, kind: 'seven_day', percentUsed: 41, resetsAt }], T0)
  expect(w).toEqual({ start: T0 - 2 * DAY_MS, resetAt: T0 + 5 * DAY_MS, percent: 41, readAt: T0 })
  expect(weekOf([], T0)).toEqual({ start: T0 - 7 * DAY_MS, resetAt: null, percent: null, readAt: null })
  const old = new Date(T0 - DAY_MS).toISOString()
  expect(weekOf([{ at: T0 - 2 * DAY_MS, kind: 'seven_day', percentUsed: 90, resetsAt: old }], T0)).toEqual({ start: T0 - DAY_MS, resetAt: T0 + 6 * DAY_MS, percent: null, readAt: null })
})

test('weekOf gives the time of the latest weekly reading, also when now is later', async () => {
  const resetsAt = new Date(T0 + 5 * DAY_MS).toISOString()
  const w = weekOf([{ at: T0 - 3 * 60 * MIN, kind: 'seven_day', percentUsed: 41, resetsAt }, { at: T0 - 60 * MIN, kind: 'five_hour', percentUsed: 9 }], T0)
  expect(w.readAt).toBe(T0 - 3 * 60 * MIN)
  expect(w.percent).toBe(41)
})

test('weekOf moves a reset in the past forward by whole weeks', async () => {
  const old = new Date(T0 - 9 * DAY_MS).toISOString()
  const w = weekOf([{ at: T0 - 10 * DAY_MS, kind: 'seven_day', percentUsed: 90, resetsAt: old }], T0)
  expect(w).toEqual({ start: T0 - 2 * DAY_MS, resetAt: T0 + 5 * DAY_MS, percent: null, readAt: null })
})

test('mergeReadings drops a reading with a resetsAt that is not a string', async () => {
  const good = { at: 1, kind: 'seven_day', percentUsed: 5, resetsAt: 'x' }
  const bad = { at: 2, kind: 'seven_day', percentUsed: 6, resetsAt: 123 }
  expect(mergeReadings([snap({ readings: [good, bad] })] as never)).toEqual([good])
})

test('groupWeek ignores hour buckets with a malformed key', async () => {
  const hours = { garbage: { 'claude-fable-5-1|main': counts(50) }, [hourKey(T0)]: { 'claude-fable-5-1|main': counts(6) } }
  expect(groupWeek([snap({ hours })] as never, T0 - DAY_MS, T0 + HOUR_MS).total).toBe(6)
})

test('groupWeek sums by repo and by model and scope inside the week', async () => {
  const hours = { [hourKey(T0)]: { 'claude-fable-5-1|main': counts(6), 'claude-opus-5-5|general-purpose': counts(2) }, [hourKey(T0 - 9 * DAY_MS)]: { 'claude-fable-5-1|main': counts(100) } }
  const g = groupWeek([snap({ hours }), snap({ key: 'run:b:1', repo: 'mobile-frontend', hours: { [hourKey(T0)]: { 'claude-opus-5-5|main': counts(2) } } })] as never, T0 - DAY_MS, T0 + HOUR_MS)
  expect(g.total).toBe(10)
  expect(g.byRepo).toEqual([{ name: 'webshop', cost: 8 }, { name: 'mobile-frontend', cost: 2 }])
  expect(g.byModelScope[0]).toEqual({ name: 'fable-5-1 main', cost: 6 })
})

test('groupWeek marks a model without a price', async () => {
  const hours = { [hourKey(T0)]: { 'claude-fable-5-1|main': counts(6), 'unknown-model|main': counts(0) } }
  const g = groupWeek([snap({ hours })] as never, T0 - DAY_MS, T0 + HOUR_MS)
  expect(g.byModelScope).toEqual([{ name: 'fable-5-1 main', cost: 6 }, { name: 'unknown-model main', cost: 0, isUnpriced: true }])
})

test('groupWeek marks a model with a fallback price as estimated, and not an exact or an unpriced model', async () => {
  const hours = {
    [hourKey(T0)]: {
      'claude-fable-5-1|main': counts(6),
      'claude-opus-5-6|main': counts(4),
      'claude-opus-5-6-20260101|main': counts(1),
      'claude-opus-4-9[1m]|Explore': counts(2),
      'claude-haiku-4-5-20251001|main': counts(1),
      'claude-mythos-1|main': counts(0),
    },
  }
  const g = groupWeek([snap({ hours })] as never, T0 - DAY_MS, T0 + HOUR_MS)
  expect(g.byModelScope).toEqual([
    { name: 'fable-5-1 main', cost: 6 },
    { name: 'opus-5-6 main', cost: 5, isEstimated: true },
    { name: 'opus-4-9[1m] Explore', cost: 2, isEstimated: true },
    { name: 'haiku-4-5 main', cost: 1 },
    { name: 'mythos-1 main', cost: 0, isUnpriced: true },
  ])
  // The repo table mixes models: no flag
  expect(g.byRepo).toEqual([{ name: 'webshop', cost: 14 }])
})

test('breakdownOf keeps used categories, loaded MCP tools by server and the 10 largest memory files', async () => {
  const b = breakdownOf({
    totalTokens: 412_000,
    rawMaxTokens: 1_000_000,
    categories: [
      { name: 'Messages', tokens: 318_000, kind: 'used' },
      { name: 'Free space', tokens: 500_000, kind: 'free' },
      { name: 'System prompt', tokens: 9_000, kind: 'used' },
    ],
    memoryFiles: Array.from({ length: 12 }, (_, i) => ({ path: 'f' + i, tokens: i })),
    mcpTools: [
      { name: 'a', serverName: 'linear', tokens: 5, isLoaded: true },
      { name: 'b', serverName: 'linear', tokens: 6, isLoaded: true },
      { name: 'c', serverName: 'notion', tokens: 100, isLoaded: false },
    ],
    agents: [{ agentType: 'second-opinion', tokens: 300 }],
  })
  expect(b.categories.map((c) => c.name)).toEqual(['Messages', 'System prompt'])
  expect(b.memoryFiles.length).toBe(10)
  expect(b.memoryFiles[0]).toEqual({ name: 'f11', tokens: 11 })
  expect(b.mcpServers).toEqual([{ name: 'linear', tokens: 11 }])
  expect(b.agents).toEqual([{ name: 'second-opinion', tokens: 300 }])
})
