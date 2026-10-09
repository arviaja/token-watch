import type { Limit, Main } from '../types'
import { clockTime, dayTime, formatMoney, formatTokens, fullAt } from './format'
import { familyOf, priceOf, ratesOf, rewarmCost } from './prices'
import { TTL_MS } from './temperature'

// The thresholds of the actions
// send now: the last 10 minutes of a 1-hour cache. A 5-minute cache leaves too little time to act
export const SEND_NOW_MS = 10 * 60_000
// send now and /clear: the cache actions show when writing the context again costs this much or more, at API prices
export const BIG_REWARM_USD = 1
// /compact: from 400k tokens, 40% of a window of 1M
export const COMPACT_TOKENS = 400_000
// 5h full: the 5-hour window reaches 100% within the next 60 minutes
export const FIVE_HOUR_SOON_MS = 60 * 60_000

const WEEK_MS = 7 * 24 * 3_600_000
const FIVE_HOUR_MS = 5 * 3_600_000

export type ActionKind = 'weekUsedUp' | 'fiveHour' | 'slowDown' | 'sendNow' | 'clear' | 'compact'

// The one action of the band: the verb in bold, then the rest in the text colour
export type Action = { kind: ActionKind; verb: string; rest: string }

// The range of the week: it lasts until the reset at the pace so far, or it runs out at a time before the reset
export type WeekRange = { kind: 'lasts' } | { kind: 'runsOut'; at: number }

export type AdviceInput = { main: Main; limits: readonly Limit[]; limitsAt: number | null; now: number }

function resetOf(limit: Limit): number | null {
  const at = limit.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
  return Number.isFinite(at) ? at : null
}

// The next smaller family for the model hint: Fable, Mythos and Opus to Sonnet, Sonnet to Haiku. Haiku and other models get no hint
export function smallerFamily(model: string): string | null {
  const family = familyOf(model)
  if (family === 'fable' || family === 'mythos' || family === 'opus') return 'Sonnet'
  return family === 'sonnet' ? 'Haiku' : null
}

function hint(model: string): string {
  const smaller = smallerFamily(model)
  return smaller === null ? '' : ' or use ' + smaller
}

// The range of the weekly limit, from the pace between the start of the week and the reading. Null without a reset time,
// without a reading, at 100% or more, after the reset, and when the time of 100% has passed (an old reading)
export function weekRange(limit: Limit | undefined, readAt: number | null, now: number): WeekRange | null {
  if (limit === undefined || readAt === null || limit.percentUsed >= 100) return null
  const resetAt = resetOf(limit)
  if (resetAt === null || resetAt <= now) return null
  const at = fullAt(limit.percentUsed, resetAt - WEEK_MS, readAt)
  if (at === null || at >= resetAt) return { kind: 'lasts' }
  return at > now ? { kind: 'runsOut', at } : null
}

// The time when the 5-hour window reaches 100%, when that is before its reset and within the next 60 minutes, or null
export function fiveHourFullAt(limit: Limit | undefined, readAt: number | null, now: number): number | null {
  if (limit === undefined || readAt === null) return null
  const resetAt = resetOf(limit)
  if (resetAt === null) return null
  const at = fullAt(limit.percentUsed, resetAt - FIVE_HOUR_MS, readAt)
  return at !== null && at < resetAt && at > now && at - now <= FIVE_HOUR_SOON_MS ? at : null
}

// The one action that the band shows, by priority: the limits first, then the cache, then the context. Null for no action.
// The cache actions need a known cache life and no running turn
export function actionOf(d: AdviceInput): Action | null {
  const week = d.limits.find((l) => l.kind === 'seven_day')
  const fiveHour = d.limits.find((l) => l.kind === 'five_hour')
  const m = d.main
  // A reading of 100% counts until its reset; after the reset it is an old reading that the next response replaces
  const weekResetAt = week === undefined ? null : resetOf(week)
  if (week !== undefined && week.percentUsed >= 100 && (weekResetAt === null || weekResetAt > d.now)) {
    const resetAt = weekResetAt
    return { kind: 'weekUsedUp', verb: 'week used up', rest: ': usage credits' + (resetAt === null ? '' : ' until ' + dayTime(resetAt)) }
  }
  const fullAt5h = fiveHourFullAt(fiveHour, d.limitsAt, d.now)
  if (fullAt5h !== null) return { kind: 'fiveHour', verb: '5h full at ' + clockTime(fullAt5h), rest: ': pause' + hint(m.model) }
  if (weekRange(week, d.limitsAt, d.now)?.kind === 'runsOut') return { kind: 'slowDown', verb: 'slow down', rest: hint(m.model) }
  if (m.isWorking) return null
  const ttl = m.ttl ?? null
  if (ttl !== null && m.lastRequestAt !== null && priceOf(m.model) !== undefined) {
    const expiresAt = m.lastRequestAt + TTL_MS[ttl]
    const rewarm = rewarmCost(m.model, m.contextTokens, ttl)
    if (rewarm >= BIG_REWARM_USD) {
      const left = expiresAt - d.now
      if (ttl === '1h' && left > 0 && left <= SEND_NOW_MS) return { kind: 'sendNow', verb: 'send now', rest: ': after ' + clockTime(expiresAt) + ' the next message costs ' + formatMoney(rewarm) }
      if (left <= 0) return { kind: 'clear', verb: '/clear', rest: ' if the topic changed' }
    }
  }
  if (m.contextTokens >= COMPACT_TOKENS) {
    const price = priceOf(m.model)
    const read = price === undefined ? null : (m.contextTokens * ratesOf(price, m.contextTokens).read) / 1e6
    return { kind: 'compact', verb: '/compact', rest: ': each message reads ' + formatTokens(m.contextTokens) + (read === null ? '' : ' ≈ ' + formatMoney(read)) }
  }
  return null
}
