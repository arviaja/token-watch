import { expect, test } from 'claude-code/testing'
import { BIG_REWARM_USD, COMPACT_TOKENS, FIVE_HOUR_SOON_MS, SEND_NOW_MS, actionOf, fiveHourFullAt, smallerFamily, weekRange } from '../hooks/advice'
import { clockTime, dayTime } from '../hooks/format'
import { rewarmCost } from '../hooks/prices'
import { NO_MAIN } from '../hooks/tally'
import type { Limit, Main } from '../types'

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// The week resets 3 days after T0, so it started 4 days before. The 5-hour window resets 4 hours after T0, so it started 1 hour before
const WEEK_RESET = T0 + 3 * DAY
const FIVE_RESET = T0 + 4 * HOUR
const week = (percentUsed: number, resetsAt: number | null = WEEK_RESET): Limit => ({ kind: 'seven_day', percentUsed, ...(resetsAt === null ? {} : { resetsAt: new Date(resetsAt).toISOString() }) })
const fiveHour = (percentUsed: number): Limit => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(FIVE_RESET).toISOString() })

// A main conversation on Fable 5.1 with its last request at T0. 120k costs $2.40 to write again with the 1-hour price
const main = (over: Partial<Main> = {}): Main => ({ ...NO_MAIN, model: 'claude-fable-5-1', lastRequestAt: T0, ttl: '1h', contextTokens: 120_000, ...over })
const at = (now: number, m: Partial<Main> = {}, limits: Limit[] = [week(41), fiveHour(12)]) => actionOf({ main: main(m), limits, limitsAt: T0, now })

test('the thresholds are the decisions of the issue', async () => {
  expect(SEND_NOW_MS).toBe(10 * MIN)
  expect(BIG_REWARM_USD).toBe(1)
  expect(COMPACT_TOKENS).toBe(400_000)
  expect(FIVE_HOUR_SOON_MS).toBe(60 * MIN)
})

test('smallerFamily names the next smaller family, and nothing for Haiku and other models', async () => {
  expect(smallerFamily('claude-fable-5-1')).toBe('Sonnet')
  expect(smallerFamily('claude-mythos-5-1')).toBe('Sonnet')
  expect(smallerFamily('claude-opus-5-5[1m]')).toBe('Sonnet')
  expect(smallerFamily('claude-sonnet-5-5')).toBe('Haiku')
  expect(smallerFamily('claude-haiku-5-5')).toBeNull()
  expect(smallerFamily('gpt-6-sol')).toBeNull()
  expect(smallerFamily('')).toBeNull()
})

test('weekRange: the week lasts until its reset, runs out before it, or has no range', async () => {
  // At 41% after 4 of 7 days the pace lasts; at 76% it runs out after 4 / 0.76 = 5.26 days
  expect(weekRange(week(41), T0, T0)).toEqual({ kind: 'lasts' })
  expect(weekRange(week(76), T0, T0)).toEqual({ kind: 'runsOut', at: WEEK_RESET - 7 * DAY + (4 * DAY * 100) / 76 })
  // 0% has no pace: it lasts
  expect(weekRange(week(0), T0, T0)).toEqual({ kind: 'lasts' })
  // No reset time, no reading, used up, or a time that has passed: no range
  expect(weekRange(week(41, null), T0, T0)).toBeNull()
  expect(weekRange(week(41), null, T0)).toBeNull()
  expect(weekRange(week(100), T0, T0)).toBeNull()
  expect(weekRange(week(76), T0, T0 + 2 * DAY)).toBeNull()
  expect(weekRange(undefined, T0, T0)).toBeNull()
})

test('fiveHourFullAt gives the time of 100% only when it is before the reset and within the next 60 minutes', async () => {
  // At 88% one hour into the window: 100% at 68.2 minutes, 8.2 minutes after T0
  const full = FIVE_RESET - 5 * HOUR + (HOUR * 100) / 88
  expect(fiveHourFullAt(fiveHour(88), T0, T0)).toBe(full)
  // At 62% the window fills at 96.8 minutes: 36.8 minutes after T0, also within the hour
  expect(fiveHourFullAt(fiveHour(62), T0, T0)).toBe(FIVE_RESET - 5 * HOUR + (HOUR * 100) / 62)
  // At 40% it fills at 150 minutes: 90 minutes after T0, not within the hour
  expect(fiveHourFullAt(fiveHour(40), T0, T0)).toBeNull()
  // At 15% it fills after the reset
  expect(fiveHourFullAt(fiveHour(15), T0, T0)).toBeNull()
  // A time that has passed
  expect(fiveHourFullAt(fiveHour(88), T0, full + MIN)).toBeNull()
})

test('the actions come in their order: week used up, 5h full, slow down, send now, /clear, /compact', async () => {
  const all: Limit[] = [week(100), fiveHour(88)]
  const late = T0 + 52 * MIN
  expect(at(late, { contextTokens: 640_000 }, all)?.kind).toBe('weekUsedUp')
  expect(at(T0 + 2 * MIN, { contextTokens: 640_000 }, [week(76), fiveHour(88)])?.kind).toBe('fiveHour')
  expect(at(late, { contextTokens: 640_000 }, [week(76), fiveHour(12)])?.kind).toBe('slowDown')
  expect(at(late, { contextTokens: 640_000 })?.kind).toBe('sendNow')
  expect(at(T0 + 75 * MIN, { contextTokens: 640_000 })?.kind).toBe('clear')
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000 })?.kind).toBe('compact')
  expect(at(T0 + 13 * MIN)).toBeNull()
})

test('the texts of the actions', async () => {
  expect(at(T0, {}, [week(100)])).toEqual({ kind: 'weekUsedUp', verb: 'week used up', rest: ': usage credits until ' + dayTime(WEEK_RESET) })
  expect(at(T0, {}, [week(100, null)])?.rest).toBe(': usage credits')
  const full = FIVE_RESET - 5 * HOUR + (HOUR * 100) / 88
  expect(at(T0 + 2 * MIN, {}, [week(41), fiveHour(88)])).toEqual({ kind: 'fiveHour', verb: '5h full at ' + clockTime(full), rest: ': pause or use Sonnet' })
  expect(at(T0 + 2 * MIN, { model: 'claude-haiku-5-5' }, [week(41), fiveHour(88)])?.rest).toBe(': pause')
  expect(at(T0, {}, [week(76)])).toEqual({ kind: 'slowDown', verb: 'slow down', rest: ' or use Sonnet' })
  expect(at(T0, { model: 'claude-sonnet-5-5' }, [week(76)])?.rest).toBe(' or use Haiku')
  expect(at(T0 + 52 * MIN)).toEqual({ kind: 'sendNow', verb: 'send now', rest: ': after ' + clockTime(T0 + HOUR) + ' the next message costs $2.40' })
  expect(at(T0 + 75 * MIN)).toEqual({ kind: 'clear', verb: '/clear', rest: ' if the topic changed' })
  // 640k at the read price of Fable 5.1, 0.25 per million
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000 })).toEqual({ kind: 'compact', verb: '/compact', rest: ': each message reads 640k ≈ $0.16' })
})

test('send now shows only in the last 10 minutes of a 1-hour cache whose re-warm costs $1 or more', async () => {
  expect(at(T0 + 50 * MIN)?.kind).toBe('sendNow')
  expect(at(T0 + 50 * MIN - 1)).toBeNull()
  expect(at(T0 + 60 * MIN - 1)?.kind).toBe('sendNow')
  // At the end of the hour the cache is cold: /clear
  expect(at(T0 + 60 * MIN)?.kind).toBe('clear')
  // Never on a 5-minute cache: it goes from no action to /clear
  expect(at(T0 + 4 * MIN, { ttl: '5m' })).toBeNull()
  expect(at(T0 + 5 * MIN, { ttl: '5m' })?.kind).toBe('clear')
  // The re-warm threshold: 49,999 tokens of Fable 5.1 cost $0.99998, 50,000 cost $1.00
  expect(rewarmCost('claude-fable-5-1', 50_000, '1h')).toBe(1)
  expect(at(T0 + 52 * MIN, { contextTokens: 50_000 })?.kind).toBe('sendNow')
  expect(at(T0 + 52 * MIN, { contextTokens: 49_999 })).toBeNull()
  expect(at(T0 + 75 * MIN, { contextTokens: 49_999 })).toBeNull()
})

test('the cache actions need a known cache life, a request, a price and no running turn', async () => {
  expect(at(T0 + 52 * MIN, { ttl: null })).toBeNull()
  expect(at(T0 + 75 * MIN, { ttl: null })).toBeNull()
  expect(at(T0 + 52 * MIN, { lastRequestAt: null })).toBeNull()
  expect(at(T0 + 52 * MIN, { model: 'claude-mythos-1' })).toBeNull()
  expect(at(T0 + 52 * MIN, { isWorking: true })).toBeNull()
  // The limit actions show also during a turn
  expect(at(T0, { isWorking: true }, [week(76)])?.kind).toBe('slowDown')
})

test('/compact shows from 400k tokens, also with an unknown cache life, and names no price for a model without one', async () => {
  expect(at(T0 + 13 * MIN, { contextTokens: 400_000 })?.kind).toBe('compact')
  expect(at(T0 + 13 * MIN, { contextTokens: 399_999 })).toBeNull()
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000, ttl: null })?.kind).toBe('compact')
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000, model: 'claude-mythos-1' })?.rest).toBe(': each message reads 640k')
  // Haiku 5.5 reads a prompt above 100,000 tokens at 0.05 per million: 640k for $0.03
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000, model: 'claude-haiku-5-5' })?.rest).toBe(': each message reads 640k ≈ $0.03')
  expect(at(T0 + 13 * MIN, { contextTokens: 640_000, isWorking: true })).toBeNull()
})

test('a weekly reading of 100% whose reset has passed is an old reading: no week used up and no range', async () => {
  // Three days after the last request the cache is cold: /clear, not week used up
  expect(at(WEEK_RESET + MIN, {}, [week(100)])?.kind).toBe('clear')
  expect(at(WEEK_RESET - MIN, {}, [week(100)])?.kind).toBe('weekUsedUp')
  expect(weekRange(week(41), T0, WEEK_RESET + MIN)).toBeNull()
})
