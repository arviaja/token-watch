import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Counts, Run, Snapshot, Ttl } from '../types'
import { repoName } from './format'
import { costOf, matchLifetime, priceInfo, writeCostOf } from './prices'
import { OUTPUT_CAP, RECOMMEND_EFFORT, RECOMMEND_SCOPE, RECOMMEND_SYSTEM, RECOMMEND_TIMEOUT_MS, drawableText, estimateTokens, failureText, maxCostOf, modelOption, priceModelOf, recommendPrompt, type CallUsage } from './recommend'
import { NO_LIFETIME, TTL_MS, confirmLifetime, defaultTtl, ttlFromResume } from './temperature'
import { KEEP_MS, NO_CAUSES, NO_MAIN, addCause, addReadings, addTo, breakdownOf, causeOf, contextOf, countsOf, hourKey, mainAfter, nowRows, parseSnapshot, requestsOf, rowsOf, runKey, snapshotOf, sumAll } from './tally'
import { bandData, bandEls, helpEls, nowEls, paneEls, recommendEls, sessionEls, tabsEls, weekData, weekEls, whyEls, type Els } from './view'

const run = atom({ plugin: 'token-watch', key: 'run' } as const, null)
const totals = atom({ plugin: 'token-watch', key: 'totals' } as const, {})
const causes = atom({ plugin: 'token-watch', key: 'causes' } as const, NO_CAUSES)
const main = atom({ plugin: 'token-watch', key: 'main' } as const, NO_MAIN)
const limits = atom({ plugin: 'token-watch', key: 'limits' } as const, [])
const limitsAt = atom({ plugin: 'token-watch', key: 'limitsAt' } as const, null)
const readings = atom({ plugin: 'token-watch', key: 'readings' } as const, [])
const agents = atom({ plugin: 'token-watch', key: 'agents' } as const, {})
const threads = atom({ plugin: 'token-watch', key: 'threads' } as const, {})
const threadTtls = atom({ plugin: 'token-watch', key: 'threadTtls' } as const, {})
const lifetimes = atom({ plugin: 'token-watch', key: 'lifetimes' } as const, {})
const hours = atom({ plugin: 'token-watch', key: 'hours' } as const, {})
const breakdown = atom({ plugin: 'token-watch', key: 'breakdown' } as const, null)
const others = atom({ plugin: 'token-watch', key: 'others' } as const, [])
const tab = atom({ plugin: 'token-watch', key: 'tab' } as const, 1)
const recommend = atom({ plugin: 'token-watch', key: 'recommend' } as const, null)
const isBandOn = atom({ plugin: 'token-watch', key: 'isBandOn' } as const, true)
const isPaneOpen = atom({ plugin: 'token-watch', key: 'isPaneOpen' } as const, false)
const isBandHidden = atom({ plugin: 'token-watch', key: 'isBandHidden' } as const, false)

// The pane's id, used to open the pane and to recognize it when drawing
const PANE = 'token-watch'
// The settings of all sessions on this Mac: { band: 'on' | 'off' }. band off hides the band, and a missing value shows it.
// The key does not start with run:, so the clean-up and the list of the other sessions leave it alone
const SETTINGS_KEY = 'settings'
const BAND_OFF = 'Band off in all sessions on this Mac. The mod still counts. /token-watch band on shows it again.'
const BAND_ON = 'Band on in all sessions on this Mac.'
const BAND_IS_OFF = 'The band is off. /token-watch band on shows it.'
const BAND_IS_ON = 'The band is on. /token-watch band off hides it.'
const BAND_HIDDEN = 'Band hidden in this session. /token-watch band on shows it again.'
const BAND_IS_HIDDEN = 'The band is hidden in this session. /token-watch band on shows it.'
// The dialog of /token-watch recommend is a pane of its own, so the tabs keep their state
const RECOMMEND_PANE = 'token-watch-recommend'
const RECOMMEND_TITLE = 'token-watch recommend'
const STALE_ASK = 'The call stopped: the mod loaded again while the call ran. Run /token-watch recommend again.'

// The module's own flags start over on a reload; the data lives in $.state and $.store
let isDirty = false
// Stops the running call of /token-watch recommend when the dialog closes
let stopRecommend: AbortController | null = null
// The last session cost that the mod has read, in USD. A module variable and not $.state: bookedSince reads and writes it with no await
// in between, so two requests that end together never both count from one old value. A reload starts it over; the next reading sets it again
let costSeen: number | null = null

// The cost that Claude Code booked since the last reading of any request, or null. A lower reading (the session cost started again,
// or a late reading) starts the count over. The first reading only sets the start
function bookedSince(usd: number | null): number | null {
  if (usd === null) return null
  const before = costSeen
  costSeen = usd
  if (before === null || usd < before) return null
  return usd - before
}

async function newRun($: any): Promise<Run> {
  const next: Run = { sessionId: await $.session.id(), startedAt: await $.clock.now(), repo: repoName(await $.session.root()) }
  await update($, run, () => next)
  return next
}

async function ensureRun($: any): Promise<Run> {
  return (await read($, run)) ?? newRun($)
}

async function flush($: any): Promise<boolean> {
  try {
    const current = await read($, run)
    if (current === null) return true
    const m = await read($, main)
    const h = await read($, hours)
    // A conversation writes its key after its first request
    if (m.lastRequestAt === null && Object.keys(h).length === 0) return true
    const now = await $.clock.now()
    const snapshot = snapshotOf(current, m, await read($, readings), h, now)
    await $.store.set(runKey(current), snapshot)
    return true
  } catch {
    // The store is full or not available; the next tick tries again
    return false
  }
}

async function tick($: any): Promise<void> {
  if (isDirty) {
    isDirty = false
    if (!(await flush($))) isDirty = true
  }
  if (await isOthersShown($)) await loadOthers($)
  await loadSettings($)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function isPaneShown($: any): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p: { id: string; isShown: boolean }) => p.id === PANE && p.isShown)
  } catch {
    return false
  }
}

// The list of the other conversations is read only while the pane shows the Now or the Week tab
async function isOthersShown($: any): Promise<boolean> {
  if (!(await isPaneShown($))) return false
  const n = await read($, tab)
  return n === 1 || n === 3
}

// A missing or unknown value shows the band
function isBandOnIn(settings: unknown): boolean {
  return !(typeof settings === 'object' && settings !== null && (settings as { band?: unknown }).band === 'off')
}

// Another session can change the setting, so the tick reads it again
async function loadSettings($: any): Promise<void> {
  try {
    const isOn = isBandOnIn(await $.store.get(SETTINGS_KEY))
    if ((await read($, isBandOn)) === isOn) return
    await update($, isBandOn, () => isOn)
    $.ui.invalidate('ui.render')
  } catch {
    // Keep the last value; the next tick reads again
  }
}

// The store holds the setting for all sessions. A failed write changes nothing, because the next tick reads the store again
async function setBand($: any, isOn: boolean): Promise<void> {
  // band on also shows a band that the × hid in this session. That needs no store, so it holds also when the write fails
  if (isOn) await update($, isBandHidden, () => false)
  try {
    const current = await $.store.get(SETTINGS_KEY)
    const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}
    await $.store.set(SETTINGS_KEY, { ...base, band: isOn ? 'on' : 'off' })
  } catch (error) {
    $.ui.invalidate('ui.render')
    $.ui.toast('The band setting was not saved: ' + messageOf(error))
    return
  }
  await update($, isBandOn, () => isOn)
  $.ui.invalidate('ui.render')
  $.ui.toast(isOn ? BAND_ON : BAND_OFF)
}

// The × of the band: this session only. The store and the other sessions stay unchanged
async function hideBand($: any): Promise<void> {
  await update($, isBandHidden, () => true)
  $.ui.invalidate('ui.render')
  $.ui.toast(BAND_HIDDEN)
}

async function bandStateText($: any): Promise<string> {
  if (!(await read($, isBandOn))) return BAND_IS_OFF
  return (await read($, isBandHidden)) ? BAND_IS_HIDDEN : BAND_IS_ON
}

// The band button reads the flag for its label, so each open and close sets it. The flag means that the pane is up: shown, covered by another pane, or waiting for room
async function markPane($: any, isOpen: boolean): Promise<void> {
  await update($, isPaneOpen, () => isOpen)
  $.ui.invalidate('ui.render')
}

// Returns why the pane did not open, or null
async function openPane($: any): Promise<string | null> {
  await loadOthers($)
  if ((await read($, tab)) === 4) await loadBreakdown($)
  try {
    const opened = await $.ui.open({ id: PANE, title: 'token-watch', focus: true, closeOnEscape: true, columns: 80, rows: 24 })
    await markPane($, true)
    if (opened.isPlaced === false) return 'The token-watch pane is waiting: ' + (opened.reason ?? 'no reason given')
  } catch (error) {
    // A refused open must not throw into the session: say why instead
    return 'The token-watch pane did not open: ' + messageOf(error)
  }
  return null
}

// The engine's list of panes, or the flag when the list is not available
async function isPaneUp($: any): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p: { id: string }) => p.id === PANE)
  } catch {
    return read($, isPaneOpen)
  }
}

// A pane that is up closes, also when another pane covers it or it waits for room, so the label [ close ] always closes it.
// The mod's own $.ui.close does not run its own ui.close hook, so this function marks the pane closed itself
async function togglePane($: any): Promise<string | null> {
  if (!(await isPaneUp($))) return openPane($)
  try {
    await $.ui.close({ id: PANE })
  } catch (error) {
    return 'The token-watch pane did not close: ' + messageOf(error)
  }
  await markPane($, false)
  return null
}

// The band button is not a slash command, so a press adds nothing to the conversation. A message shows as a toast
async function pressPane($: any): Promise<void> {
  const message = await togglePane($)
  if (message !== null) $.ui.toast(message)
}

async function loadOthers($: any): Promise<void> {
  try {
    const list = []
    for (const key of await $.store.keys()) {
      if (!key.startsWith('run:')) continue
      const snapshot = parseSnapshot(await $.store.get(key))
      if (snapshot !== null) list.push(snapshot)
    }
    await update($, others, () => list)
  } catch {
    // Keep the last list
  }
}

async function prune($: any): Promise<void> {
  try {
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      if (!key.startsWith('run:')) continue
      const snapshot = parseSnapshot(await $.store.get(key))
      if (snapshot === null || snapshot.updatedAt < now - KEEP_MS) await $.store.delete(key)
    }
  } catch {
    // The next session start tries again
  }
}

// readAt is the time of the API response that reported the limits. Without it, the limits count as read now
async function saveLimits($: any, list: readonly { kind: string; percentUsed: number; resetsAt?: string }[], readAt?: number): Promise<void> {
  if (list.length === 0) return
  const at = readAt ?? (await $.clock.now())
  await update($, limits, () => list.map((l) => ({ ...l })))
  await update($, limitsAt, () => at)
  await update($, readings, (r) => addReadings(r, list, at))
  isDirty = true
}

async function loadLimits($: any, readAt?: number): Promise<void> {
  try {
    const usage = await $.session.usage()
    await saveLimits($, usage.rateLimits ?? [], readAt)
  } catch {
    // The first session.measure brings the limits
  }
}

async function loadBreakdown($: any): Promise<void> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const input = usage.context.breakdown
    if (input) await update($, breakdown, () => breakdownOf(input))
  } catch {
    // Tab 4 keeps its wait text
  }
}

async function selectTab($: any, n: number): Promise<void> {
  await update($, tab, () => n)
  if (n === 4) await loadBreakdown($)
  if (n === 1 || n === 3) await loadOthers($)
}

// The snapshots of the store, with this conversation's fresh data in place of its stored copy
async function allSnapshots($: any, now: number): Promise<Snapshot[]> {
  const current = await read($, run)
  const stored = await read($, others)
  if (current === null) return [...stored]
  const own = snapshotOf(current, await read($, main), await read($, readings), await read($, hours), now)
  return [...stored.filter((s) => s.key !== own.key), own]
}

async function sessionCost($: any): Promise<number | null> {
  try {
    const usage = await $.session.usage()
    return usage.cost?.usd ?? null
  } catch {
    return null
  }
}

// The type of a subagent comes from the agent list of the session, once for each agent.
// An agent that the list does not hold (a workflow's) keeps the scope subagent.
async function agentTypeOf($: any, agentId: string): Promise<string> {
  const known = (await read($, agents))[agentId]
  if (known !== undefined) return known
  let listed: { id: string; type: string }[]
  try {
    listed = await $.agent.list()
  } catch {
    // The request still counts, under the scope subagent; the next request asks again
    return 'subagent'
  }
  const type = listed.find((a) => a.id === agentId)?.type || 'subagent'
  await update($, agents, (a) => ({ ...a, [agentId]: type }))
  return type
}

// The dialog of /token-watch recommend: it reads the data of the tabs, builds the prompt and shows the cost. No call runs here
async function openRecommend($: any, model: string): Promise<{ text?: string }> {
  // A new dialog takes the place of the old one, so the reply of a call that runs has no place to show
  stopRecommend?.abort()
  const now = await $.clock.now()
  await loadOthers($)
  await loadBreakdown($)
  const m = await read($, main)
  const prompt = recommendPrompt({
    now,
    totals: await read($, totals),
    causes: await read($, causes),
    usd: await sessionCost($),
    requests: requestsOf(m),
    mainTtl: m.ttl ?? null,
    resumes: m.resumes,
    limits: await read($, limits),
    limitsAt: await read($, limitsAt),
    week: weekData(await allSnapshots($, now), now),
    breakdown: await read($, breakdown),
  })
  const priceModel = priceModelOf(model)
  const inputTokens = estimateTokens(RECOMMEND_SYSTEM + prompt)
  await update($, recommend, () => ({ id: now, phase: 'confirm' as const, model, priceModel, prompt, inputTokens, outputCap: OUTPUT_CAP, maxCost: maxCostOf(priceInfo(priceModel), inputTokens, OUTPUT_CAP), text: '', counts: null }))
  try {
    // A dialog: it takes the keys, Esc closes it, and the toasts wait until it closes
    const opened = await $.ui.open({ id: RECOMMEND_PANE, title: RECOMMEND_TITLE, focus: true, closeOnEscape: true, holdToasts: true, columns: 80, rows: 18 })
    if (opened.isPlaced === false) return { text: 'The token-watch recommend dialog is waiting: ' + (opened.reason ?? 'no reason given') }
  } catch (error) {
    return { text: 'The token-watch recommend dialog did not open: ' + messageOf(error) }
  }
  return {}
}

// The call runs only from the Ask button of the dialog
async function askRecommend($: any): Promise<void> {
  const r = await read($, recommend)
  if (r === null || r.phase !== 'confirm') return
  // Only one press moves the dialog from confirm to asking, so two quick presses run one call
  let isStarted = false
  await update($, recommend, (v) => {
    isStarted = v !== null && v.id === r.id && v.phase === 'confirm'
    return isStarted ? { ...v!, phase: 'asking' as const } : v
  })
  if (!isStarted) return
  try {
    // The pane stays open for the reply: it no longer holds the toasts, and it asks for more rows
    await $.ui.open({ id: RECOMMEND_PANE, title: RECOMMEND_TITLE, closeOnEscape: true, columns: 80, rows: 24 })
  } catch {
    // The pane keeps its size
  }
  const stop = new AbortController()
  stopRecommend = stop
  let result: { isAnswered: boolean; text?: string; reason?: string; status?: number | null; error?: string; usage?: CallUsage }
  try {
    result = await $.model.complete({ model: r.model, system: RECOMMEND_SYSTEM, prompt: r.prompt, maxTokens: r.outputCap, effort: RECOMMEND_EFFORT, timeoutMs: RECOMMEND_TIMEOUT_MS }, { signal: stop.signal })
  } catch (error) {
    // The engine refused to send the request, for example for a model that is not allowed. No call ran
    await update($, recommend, (v) => (v?.id === r.id ? { ...v, phase: 'failed' as const, text: drawableText('The request was not sent: ' + messageOf(error)) } : v))
    return
  } finally {
    if (stopRecommend === stop) stopRecommend = null
  }
  const counts = await countRecommend($, r.priceModel, result.usage)
  const isAnswered = result.isAnswered && typeof result.text === 'string'
  await update($, recommend, (v) => (v?.id === r.id ? { ...v, phase: isAnswered ? ('answered' as const) : ('failed' as const), text: isAnswered ? drawableText(result.text!) : failureText(result), counts } : v))
}

// The usage of the call goes into the totals and the hours under the scope recommend, so the Session and the Week tab show its cost.
// The call does not use the cache of a conversation, so a cache write has the 5-minute price, as in a subagent
async function countRecommend($: any, priceModel: string, usage: CallUsage | undefined): Promise<Counts | null> {
  if (!usage) return null
  const record = { model: priceModel, ...usage }
  const counts = countsOf(record, costOf(record, '5m'))
  if (counts.input + counts.output + counts.cacheRead + counts.cacheWrite === 0) return null
  const at = await $.clock.now()
  await update($, totals, (t) => addTo(t, priceModel, RECOMMEND_SCOPE, counts))
  await update($, hours, (h) => addTo(h, hourKey(at), priceModel + '|' + RECOMMEND_SCOPE, counts))
  isDirty = true
  return counts
}

// A close of the dialog stops a call that runs, because its reply has no place to show.
// The mod's own $.ui.close does not pass its own ui.close hook, so Cancel does the same work as the hook
async function endRecommend($: any): Promise<void> {
  stopRecommend?.abort()
  await update($, recommend, () => null)
}

// A reload of the module drops a call that runs, with the old module. The dialog then says so, instead of waiting for a reply that does not come
async function dropStaleAsk($: any): Promise<void> {
  await update($, recommend, (v) => (v?.phase === 'asking' ? { ...v, phase: 'failed' as const, text: STALE_ASK } : v))
}

async function closeRecommend($: any): Promise<void> {
  await endRecommend($)
  await $.ui.close({ id: RECOMMEND_PANE })
}

// The state of the old conversation must not reach the new one
async function resetConversation($: any): Promise<void> {
  await update($, totals, () => ({}))
  await update($, causes, () => NO_CAUSES)
  await update($, main, () => NO_MAIN)
  await update($, threads, () => ({}))
  await update($, threadTtls, () => ({}))
  await update($, agents, () => ({}))
  await update($, readings, () => [])
  await update($, hours, () => ({}))
  await update($, limits, () => [])
  await update($, limitsAt, () => null)
  await update($, breakdown, () => null)
}

// A resumed conversation brings the time of its last response, so the cache temperature is right at once
async function seedResumed($: any, e: { seconds_since_last_response?: unknown; prompt_cache_likely_expired?: unknown; context_tokens?: unknown; model?: unknown }): Promise<void> {
  const seconds = e.seconds_since_last_response
  const context = e.context_tokens
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return
  if (typeof context !== 'number' || !Number.isFinite(context) || context <= 0) return
  const at = (await $.clock.now()) - seconds * 1000
  let model = typeof e.model === 'string' && e.model !== '' ? e.model : ''
  // The resume event of some builds has no model; the session knows it
  if (model === '') {
    try {
      const current = await $.session.model()
      if (typeof current === 'string' && current !== '') model = current
    } catch {
      // The model stays empty until the first request
    }
  }
  // Claude Code says whether the cache expired, which can prove the life of the last cache. It proves nothing about the life of the next requests
  const ttl = ttlFromResume(seconds, e.prompt_cache_likely_expired)
  await update($, main, (m) => ({ ...m, lastRequestAt: at, ttl, contextTokens: context, ...(model !== '' ? { model } : {}) }))
  await update($, threads, (t) => ({ ...t, main: at }))
  if (ttl !== null) await update($, threadTtls, (t) => ({ ...t, main: ttl }))
}

export const register: Register = (on, options) => {
  // A change of the option in /config loads the module again
  const recommendModel = modelOption(options)

  on('session.start', async ($, e, next) => {
    try {
      await ensureRun($)
      isDirty = true
      await loadLimits($)
      await loadSettings($)
      // session.start also runs after a reload of the module
      await dropStaleAsk($)
      // The pane can stay open over a reload of the module
      const isOpen = await isPaneUp($)
      await update($, isPaneOpen, () => isOpen)
    } catch {
      // The timers and the command are still registered
    }
    $.clock.after(5_000, () => {
      void prune($)
    })
    $.clock.every(30_000, () => {
      $.ui.invalidate('ui.render')
    })
    $.clock.every(15_000, () => {
      void tick($)
    })
    try {
      await $.command.register({ name: 'token-watch', description: 'Show token use, plan limits and cache temperature', argumentHint: '[recommend | band on | band off]', immediate: true })
    } catch {
      // The name is taken after a reload; the command from the first load stays
    }
    return next(e)
  })

  // A new conversation has empty state and gets its own store key
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // The limits of the session come from its last API response, which can be older than the new conversation: they keep the time of the last reading
    const lastReadAt = await read($, limitsAt)
    costSeen = null
    await newRun($)
    await resetConversation($)
    if (e.source === 'resume' || e.source === 'fork') await seedResumed($, e)
    isDirty = true
    await loadLimits($, lastReadAt ?? undefined)
    return next(e)
  }).catch(($, e, next) => next(e)) // Observation only; the session start goes on

  on('session.end', async ($, e, next) => {
    await flush($)
    return next(e)
  })

  // Observes each model request; the result goes back unchanged
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    let requestAt: number | undefined
    try {
      requestAt = await $.clock.now()
      // The session cost before the request, so that a booking from before the request does not count for it
      bookedSince(await sessionCost($))
      if (agentId === undefined) await update($, main, (m) => ({ ...m, isWorking: true }))
    } catch {
      // Observation only; the request goes on
    }
    const result = yield* next(e)
    try {
      const usage = result?.usage
      if (usage) {
        // The session cost first, before any other await, so that few other bookings come in between
        const booked = bookedSince(await sessionCost($))
        const at: number = requestAt ?? (await $.clock.now())
        const isSubagent = agentId !== undefined
        const scope = isSubagent ? await agentTypeOf($, agentId) : 'main'
        const thread = agentId ?? 'main'
        // The life of the cache writes: the one whose price gives the booked cost, confirmed by confirmLifetime. Before the first match, the default of Claude Code
        const match = matchLifetime(usage, booked)
        const written = await update($, lifetimes, (l) => ({ ...l, [scope]: confirmLifetime(l[scope] ?? NO_LIFETIME, match) }))
        const known: Ttl | null = written[scope]?.known ?? null
        const ttl = known ?? defaultTtl(isSubagent)
        const counts = countsOf(usage, costOf(usage, ttl))
        // A request that neither reads nor writes the cache leaves the cache as it was
        const isCached = counts.cacheRead + counts.cacheWrite > 0
        // The gap counts against the life of the cache that the previous request of the thread left
        const previousTtl = (await read($, threadTtls))[thread] ?? ttl
        const cause = causeOf((await read($, threads))[thread], at, TTL_MS[previousTtl])
        const writeCost = writeCostOf(usage, ttl)
        await update($, totals, (t) => addTo(t, usage.model, scope, counts))
        await update($, causes, (c) => addCause(c, cause, counts.cacheWrite, writeCost))
        if (isCached) {
          await update($, threads, (t) => ({ ...t, [thread]: at }))
          await update($, threadTtls, (t) => ({ ...t, [thread]: ttl }))
        }
        await update($, hours, (h) => addTo(h, hourKey(at), usage.model + '|' + scope, counts))
        if (!isSubagent) await update($, main, (m) => mainAfter(m, usage.model, at, contextOf(counts), cause, writeCost, ttl, known, isCached))
        isDirty = true
      }
    } catch {
      // Observation only; the request result stands
    }
    return result
  })

  // At a model switch Claude Code names the cache life of the main conversation. That is a reading, so it replaces the life from the costs
  on('classic.PostModelSwitch', async ($, e, next) => {
    const ttl = e.cache_ttl
    if (ttl === '5m' || ttl === '1h') await update($, lifetimes, (l) => ({ ...l, main: { known: ttl, pending: null } }))
    return next(e)
  }).catch(($, e, next) => next(e)) // Observation only; the switch goes on

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        await update($, main, (m) => ({ ...m, isWorking: false }))
        isDirty = true
      }
    } catch {
      // Observation only
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    try {
      await saveLimits($, e.rateLimits ?? [])
    } catch {
      // Observation only
    }
    return next(e)
  })
  on('command.run', { command: 'token-watch' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).join(' ')
    if (args === 'recommend') return openRecommend($, recommendModel)
    // The band setting answers with a toast, so the transcript gets no text
    if (args === 'band on' || args === 'band off') {
      await setBand($, args === 'band on')
      return {}
    }
    if (args === 'band') {
      $.ui.toast(await bandStateText($))
      return {}
    }
    const message = await togglePane($)
    // Print nothing in the transcript, unless the pane did not open
    return message === null ? {} : { text: message }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isBandOn)) || (await read($, isBandHidden))) return next(e)
    const now = await $.clock.now()
    const data = bandData(await read($, main), await read($, totals), await read($, limits), await read($, limitsAt), now)
    if (data === null) return next(e)
    const E = $.ui.resolve(e) as unknown as Els
    // What the mods after this one draw in the band stays, below this line
    const theirs = await next(e)
    const line = bandEls(E, data, e.surface, e.props.bodyColumns, { isPaneOpen: await read($, isPaneOpen), onPane: () => pressPane($), onHide: () => hideBand($) })
    return (theirs ? E.Box({ flexDirection: 'column', children: [line, theirs] }) : line) as never
  })

  // Esc and the close mark of the person: the band button reads details again
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await markPane($, false)
    return next(e)
  }).catch(($, e, next) => next(e)) // The pane closes in all cases

  // Esc and the close mark of the person
  on('ui.close', { id: RECOMMEND_PANE }, async ($, e, next) => {
    await endRecommend($)
    return next(e)
  }).catch(($, e, next) => next(e)) // The pane closes in all cases

  on('ui.render', { component: 'Pane', requestId: RECOMMEND_PANE }, async ($, e) => {
    const E = $.ui.resolve(e) as unknown as Els
    return recommendEls(E, await read($, recommend), { onAsk: () => askRecommend($), onCancel: () => closeRecommend($) }, e.props.bodyColumns) as never
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const E = $.ui.resolve(e) as unknown as Els
    const current = await read($, tab)
    const tabs = tabsEls(E, current, (n) => selectTab($, n))
    // Tab 5 is static text: it reads no clock, no store and no state besides the tab
    if (current === 5) return paneEls(E, tabs, helpEls(E, e.props.bodyColumns, e.surface)) as never
    const now = await $.clock.now()
    let body: unknown
    if (current === 2) {
      const t = await read($, totals)
      const m = await read($, main)
      body = sessionEls(E, { rows: rowsOf(t), total: sumAll(t), causes: await read($, causes), requests: requestsOf(m), resumes: m.resumes, now, usd: await sessionCost($) }, e.props.bodyColumns, e.surface)
    } else if (current === 4) {
      body = whyEls(E, await read($, breakdown), e.props.bodyColumns, e.surface)
    } else {
      const list = await allSnapshots($, now)
      const r = await read($, run)
      body = current === 3 ? weekEls(E, weekData(list, now), e.props.bodyColumns, e.surface) : nowEls(E, nowRows(list, r === null ? '' : runKey(r), now), now, e.surface, e.props.bodyColumns)
    }
    return paneEls(E, tabs, body) as never
  })
}
