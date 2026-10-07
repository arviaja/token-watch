import type { Breakdown, BreakdownRow, Cause, Causes, Counts, Hours, Limit, Main, Reading, Run, Snapshot, Totals } from '../types'
import { shortModel } from './format'
import { priceInfo, tokens, type UsageLike } from './prices'

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
export const KEEP_MS = 8 * DAY_MS
export const STRIP_MS = 4 * HOUR_MS
export const MAX_READINGS = 400
const WORKING_MS = 10 * 60_000

export const EMPTY: Counts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, cost: 0 }
export const NO_CAUSES: Causes = { start: { tokens: 0, cost: 0 }, growth: { tokens: 0, cost: 0 }, resume: { tokens: 0, cost: 0 } }
export const NO_MAIN: Main = { model: '', lastRequestAt: null, contextTokens: 0, isWorking: false, requestTimes: [], resumes: [] }

export type Row = { model: string; scope: string; counts: Counts }
// isUnpriced: the model has no price. isEstimated: the cost uses the fallback price of the newest model of the family
export type Share = { name: string; cost: number; isUnpriced?: boolean; isEstimated?: boolean }
// readAt is the time of the last measure of the weekly reading that gives the percent, or null without a percent
export type Week = { start: number; resetAt: number | null; percent: number | null; readAt: number | null }
export type NowRow = {
  key: string
  isCurrent: boolean
  repo: string
  model: string
  contextTokens: number
  lastMainRequestAt: number | null
  isWorking: boolean
  last60: number
  today: number
}
export type BreakdownInput = {
  totalTokens: number
  rawMaxTokens: number
  categories: readonly { name: string; tokens: number; kind: string }[]
  memoryFiles: readonly { path: string; tokens: number }[]
  mcpTools: readonly { serverName: string; tokens: number; isLoaded: boolean }[]
  agents: readonly { agentType: string; tokens: number }[]
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function costOfCell(c: unknown): number {
  return isObj(c) && isNum(c.cost) ? c.cost : 0
}

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    requests: a.requests + b.requests,
    cost: a.cost + b.cost,
  }
}

export function countsOf(usage: UsageLike, cost: number): Counts {
  return {
    input: tokens(usage.input_tokens),
    output: tokens(usage.output_tokens),
    cacheRead: tokens(usage.cache_read_input_tokens),
    cacheWrite: tokens(usage.cache_creation_input_tokens),
    requests: 1,
    cost,
  }
}

// Returns a new table; the input can be frozen state
export function addTo(table: Record<string, Record<string, Counts>>, outer: string, inner: string, counts: Counts): Record<string, Record<string, Counts>> {
  const row = table[outer] ?? {}
  return { ...table, [outer]: { ...row, [inner]: addCounts(row[inner] ?? EMPTY, counts) } }
}

export function causeOf(previousAt: number | undefined, now: number, ttlMs: number): Cause {
  if (previousAt === undefined) return 'start'
  return now - previousAt > ttlMs ? 'resume' : 'growth'
}

export function addCause(causes: Causes, cause: Cause, tokenCount: number, cost: number): Causes {
  return { ...causes, [cause]: { tokens: causes[cause].tokens + tokenCount, cost: causes[cause].cost + cost } }
}

export function contextOf(c: Counts): number {
  return c.input + c.cacheRead + c.cacheWrite + c.output
}

export function mainAfter(main: Main, model: string, now: number, contextTokens: number, cause: Cause, writeCost: number): Main {
  const since = now - STRIP_MS
  return {
    ...main,
    model,
    lastRequestAt: now,
    contextTokens,
    requestTimes: [...main.requestTimes.filter((t) => t >= since), now],
    resumes: [...main.resumes.filter((r) => r.at >= since), ...(cause === 'resume' ? [{ at: now, cost: writeCost }] : [])],
  }
}

export function hourKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13)
}

export function hourStart(key: string): number {
  return Date.parse(key + ':00:00.000Z')
}

export function pruneHours(hours: Hours, now: number): Hours {
  const keep: Hours = {}
  for (const [key, value] of Object.entries(hours)) if (hourStart(key) >= now - KEEP_MS) keep[key] = value
  return keep
}

// A new reading starts when a percent moves a whole point or the reset changes.
// A measure that keeps the percent moves the seenAt of the last reading, so that the Week tab paces the week up to the last measure
export function addReadings(readings: Reading[], limits: readonly Limit[], at: number): Reading[] {
  const next = [...readings]
  for (const limit of limits) {
    const i = next.map((r) => r.kind).lastIndexOf(limit.kind)
    const last = i === -1 ? undefined : next[i]
    if (!last || Math.abs(limit.percentUsed - last.percentUsed) >= 1 || last.resetsAt !== limit.resetsAt) {
      next.push({ at, kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) })
    } else if (at > seenAtOf(last)) {
      next[i] = { ...last, seenAt: at }
    }
  }
  return next.slice(-MAX_READINGS)
}

// The time of the last measure of a reading
export function seenAtOf(r: Reading): number {
  return r.seenAt ?? r.at
}

export function rowsOf(totals: Totals): Row[] {
  const rows: Row[] = []
  for (const [model, scopes] of Object.entries(totals)) {
    const names = Object.keys(scopes).sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0))
    for (const scope of names) rows.push({ model, scope, counts: scopes[scope] })
  }
  return rows
}

export function sumAll(totals: Totals): Counts {
  return rowsOf(totals).reduce((sum, row) => addCounts(sum, row.counts), EMPTY)
}

export function modelSums(totals: Totals): { model: string; counts: Counts }[] {
  return Object.entries(totals).map(([model, scopes]) => ({
    model,
    counts: Object.values(scopes).reduce((sum, c) => addCounts(sum, c), EMPTY),
  }))
}

export function runKey(run: Run): string {
  return 'run:' + run.sessionId + ':' + run.startedAt
}

export function snapshotOf(run: Run, main: Main, readings: Reading[], hours: Hours, now: number): Snapshot {
  return {
    v: 1,
    key: runKey(run),
    sessionId: run.sessionId,
    repo: run.repo,
    model: main.model,
    updatedAt: now,
    lastMainRequestAt: main.lastRequestAt,
    contextTokens: main.contextTokens,
    isWorking: main.isWorking,
    readings: readings.filter((r) => r.kind === 'seven_day' && r.at >= now - KEEP_MS),
    hours: pruneHours(hours, now),
  }
}

export function parseSnapshot(x: unknown): Snapshot | null {
  if (!isObj(x) || x.v !== 1) return null
  if (typeof x.key !== 'string' || typeof x.sessionId !== 'string' || typeof x.repo !== 'string' || typeof x.model !== 'string') return null
  if (!isNum(x.updatedAt) || !isNum(x.contextTokens) || typeof x.isWorking !== 'boolean') return null
  if (!(x.lastMainRequestAt === null || isNum(x.lastMainRequestAt))) return null
  if (!Array.isArray(x.readings) || !isObj(x.hours)) return null
  return x as unknown as Snapshot
}

export function costIn(hours: Hours, from: number, to: number): number {
  let sum = 0
  for (const [key, cells] of Object.entries(hours)) {
    const start = hourStart(key)
    if (!(start >= from && start < to) || !isObj(cells)) continue
    for (const c of Object.values(cells)) sum += costOfCell(c)
  }
  return sum
}

// An estimate from the hourly buckets: the current hour, plus the part of the previous hour inside the last 60 minutes
export function last60(hours: Hours, now: number): number {
  const current = hourStart(hourKey(now))
  const part = 1 - (now - current) / HOUR_MS
  return costIn(hours, current, current + HOUR_MS) + costIn(hours, current - HOUR_MS, current) * part
}

export function localMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function today(hours: Hours, now: number): number {
  return costIn(hours, localMidnight(now), now + HOUR_MS)
}

export function nowRows(snaps: Snapshot[], currentKey: string, now: number): NowRow[] {
  const newest = new Map<string, Snapshot>()
  for (const s of snaps) {
    if (s.key !== currentKey && s.updatedAt < now - DAY_MS) continue
    const seen = newest.get(s.sessionId)
    if (s.key === currentKey || !seen || (seen.key !== currentKey && s.updatedAt > seen.updatedAt)) newest.set(s.sessionId, s)
  }
  return [...newest.values()]
    .map((s) => ({
      key: s.key,
      isCurrent: s.key === currentKey,
      repo: s.repo,
      model: s.model,
      contextTokens: s.contextTokens,
      lastMainRequestAt: s.lastMainRequestAt,
      isWorking: s.isWorking && now - s.updatedAt <= WORKING_MS,
      last60: last60(s.hours, now),
      today: today(s.hours, now),
    }))
    .sort((a, b) => b.last60 - a.last60 || b.today - a.today)
}

export function mergeReadings(snaps: Snapshot[]): Reading[] {
  return snaps
    .flatMap((s) => s.readings)
    .filter((r) => isObj(r) && isNum(r.at) && typeof r.kind === 'string' && isNum(r.percentUsed) && (r.resetsAt === undefined || typeof r.resetsAt === 'string') && (r.seenAt === undefined || isNum(r.seenAt)))
    .sort((a, b) => a.at - b.at)
}

export function weekOf(readings: Reading[], now: number): Week {
  // The reading with the last measure gives the percent, and the time of that measure ends the pace of the projection
  const latest = readings.filter((r) => r.kind === 'seven_day').sort((a, b) => seenAtOf(a) - seenAtOf(b)).pop()
  const resetAt = latest?.resetsAt ? Date.parse(latest.resetsAt) : Number.NaN
  if (!latest || !Number.isFinite(resetAt)) return { start: now - 7 * DAY_MS, resetAt: null, percent: null, readAt: null }
  if (resetAt <= now) {
    const weeks = Math.floor((now - resetAt) / (7 * DAY_MS)) + 1
    const next = resetAt + weeks * 7 * DAY_MS
    return { start: next - 7 * DAY_MS, resetAt: next, percent: null, readAt: null }
  }
  return { start: resetAt - 7 * DAY_MS, resetAt, percent: latest.percentUsed, readAt: seenAtOf(latest) }
}

function splitKey(name: string): [string, string] {
  const i = name.indexOf('|')
  return i === -1 ? [name, 'main'] : [name.slice(0, i), name.slice(i + 1)]
}

function sorted(map: Map<string, number>, unpriced: Set<string> = new Set(), estimated: Set<string> = new Set()): Share[] {
  return [...map.entries()]
    .map(([name, cost]) => ({ name, cost, ...(unpriced.has(name) ? { isUnpriced: true } : {}), ...(estimated.has(name) ? { isEstimated: true } : {}) }))
    .sort((a, b) => b.cost - a.cost)
}

export function groupWeek(snaps: Snapshot[], from: number, now: number): { byRepo: Share[]; byModelScope: Share[]; total: number } {
  const byRepo = new Map<string, number>()
  const byModelScope = new Map<string, number>()
  const unpriced = new Set<string>()
  const estimated = new Set<string>()
  let total = 0
  for (const s of snaps) {
    for (const [key, cells] of Object.entries(s.hours)) {
      const start = hourStart(key)
      if (!(start >= from && start <= now) || !isObj(cells)) continue
      for (const [name, c] of Object.entries(cells)) {
        const cost = costOfCell(c)
        const [model, scope] = splitKey(name)
        const label = shortModel(model) + ' ' + scope
        byRepo.set(s.repo, (byRepo.get(s.repo) ?? 0) + cost)
        byModelScope.set(label, (byModelScope.get(label) ?? 0) + cost)
        const info = priceInfo(model)
        if (info === undefined) unpriced.add(label)
        else if (info.source === 'fallback') estimated.add(label)
        total += cost
      }
    }
  }
  return { byRepo: sorted(byRepo), byModelScope: sorted(byModelScope, unpriced, estimated), total }
}

function largestFirst(rows: BreakdownRow[]): BreakdownRow[] {
  return [...rows].sort((a, b) => b.tokens - a.tokens)
}

export function breakdownOf(input: BreakdownInput): Breakdown {
  const byServer = new Map<string, number>()
  for (const tool of input.mcpTools) if (tool.isLoaded) byServer.set(tool.serverName, (byServer.get(tool.serverName) ?? 0) + tool.tokens)
  return {
    total: input.totalTokens,
    max: input.rawMaxTokens,
    categories: largestFirst(input.categories.filter((c) => c.kind === 'used').map((c) => ({ name: c.name, tokens: c.tokens }))),
    memoryFiles: largestFirst(input.memoryFiles.map((m) => ({ name: m.path, tokens: m.tokens }))).slice(0, 10),
    mcpServers: largestFirst([...byServer.entries()].map(([name, tokenCount]) => ({ name, tokens: tokenCount }))),
    agents: largestFirst(input.agents.map((a) => ({ name: a.agentType, tokens: a.tokens }))),
  }
}
