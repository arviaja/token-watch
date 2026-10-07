import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Run, Snapshot } from '../types'
import { repoName } from './format'
import { costOf, tokens, writeCostOf } from './prices'
import { MAIN_TTL_MS, SUB_TTL_MS } from './temperature'
import { KEEP_MS, NO_CAUSES, NO_MAIN, addCause, addReadings, addTo, breakdownOf, causeOf, contextOf, countsOf, hourKey, mainAfter, nowRows, parseSnapshot, rowsOf, runKey, snapshotOf, sumAll } from './tally'
import { bandData, bandEls, helpEls, nowEls, paneEls, sessionEls, tabsEls, weekData, weekEls, whyEls, type Els } from './view'

const run = atom({ plugin: 'token-watch', key: 'run' } as const, null)
const totals = atom({ plugin: 'token-watch', key: 'totals' } as const, {})
const causes = atom({ plugin: 'token-watch', key: 'causes' } as const, NO_CAUSES)
const main = atom({ plugin: 'token-watch', key: 'main' } as const, NO_MAIN)
const limits = atom({ plugin: 'token-watch', key: 'limits' } as const, [])
const limitsAt = atom({ plugin: 'token-watch', key: 'limitsAt' } as const, null)
const readings = atom({ plugin: 'token-watch', key: 'readings' } as const, [])
const agents = atom({ plugin: 'token-watch', key: 'agents' } as const, {})
const threads = atom({ plugin: 'token-watch', key: 'threads' } as const, {})
const hours = atom({ plugin: 'token-watch', key: 'hours' } as const, {})
const breakdown = atom({ plugin: 'token-watch', key: 'breakdown' } as const, null)
const others = atom({ plugin: 'token-watch', key: 'others' } as const, [])
const tab = atom({ plugin: 'token-watch', key: 'tab' } as const, 1)

// The pane's id, used to open the pane and to recognize it when drawing
const PANE = 'token-watch'

// The module's own flags start over on a reload; the data lives in $.state and $.store
let isDirty = false

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
}

// The list of the other conversations is read only while the pane shows the Now or the Week tab
async function isOthersShown($: any): Promise<boolean> {
  try {
    const isShown = (await $.ui.panes()).some((p: { id: string; isShown: boolean }) => p.id === PANE && p.isShown)
    if (!isShown) return false
    const n = await read($, tab)
    return n === 1 || n === 3
  } catch {
    return false
  }
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

// The state of the old conversation must not reach the new one
async function resetConversation($: any): Promise<void> {
  await update($, totals, () => ({}))
  await update($, causes, () => NO_CAUSES)
  await update($, main, () => NO_MAIN)
  await update($, threads, () => ({}))
  await update($, agents, () => ({}))
  await update($, readings, () => [])
  await update($, hours, () => ({}))
  await update($, limits, () => [])
  await update($, limitsAt, () => null)
  await update($, breakdown, () => null)
}

// A resumed conversation brings the time of its last response, so the cache temperature is right at once
async function seedResumed($: any, e: { seconds_since_last_response?: unknown; context_tokens?: unknown; model?: unknown }): Promise<void> {
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
  await update($, main, (m) => ({ ...m, lastRequestAt: at, contextTokens: context, ...(model !== '' ? { model } : {}) }))
  await update($, threads, (t) => ({ ...t, main: at }))
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await ensureRun($)
      isDirty = true
      await loadLimits($)
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
      await $.command.register({ name: 'token-watch', description: 'Show token use, plan limits and cache temperature', immediate: true })
    } catch {
      // The name is taken after a reload; the command from the first load stays
    }
    return next(e)
  })

  // A new conversation has empty state and gets its own store key
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // The limits of the session come from its last API response, which can be older than the new conversation: they keep the time of the last reading
    const lastReadAt = await read($, limitsAt)
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
      if (agentId === undefined) await update($, main, (m) => ({ ...m, isWorking: true }))
    } catch {
      // Observation only; the request goes on
    }
    const result = yield* next(e)
    try {
      const usage = result?.usage
      if (usage) {
        const at: number = requestAt ?? (await $.clock.now())
        const isSubagent = agentId !== undefined
        const scope = isSubagent ? await agentTypeOf($, agentId) : 'main'
        const thread = agentId ?? 'main'
        const cause = causeOf((await read($, threads))[thread], at, isSubagent ? SUB_TTL_MS : MAIN_TTL_MS)
        const counts = countsOf(usage, costOf(usage, isSubagent))
        const writeCost = writeCostOf(usage.model, tokens(usage.cache_creation_input_tokens), isSubagent)
        await update($, totals, (t) => addTo(t, usage.model, scope, counts))
        await update($, causes, (c) => addCause(c, cause, counts.cacheWrite, writeCost))
        await update($, threads, (t) => ({ ...t, [thread]: at }))
        await update($, hours, (h) => addTo(h, hourKey(at), usage.model + '|' + scope, counts))
        if (!isSubagent) await update($, main, (m) => mainAfter(m, usage.model, at, contextOf(counts), cause, writeCost))
        isDirty = true
      }
    } catch {
      // Observation only; the request result stands
    }
    return result
  })

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
  on('command.run', { command: 'token-watch' }, async ($) => {
    await loadOthers($)
    if ((await read($, tab)) === 4) await loadBreakdown($)
    try {
      const opened = await $.ui.open({ id: PANE, title: 'token-watch', focus: true, closeOnEscape: true, columns: 80, rows: 24 })
      if (opened.isPlaced === false) return { text: 'The token-watch pane is waiting: ' + (opened.reason ?? 'no reason given') }
    } catch (error) {
      // A refused open must not throw into the session: say why instead
      return { text: 'The token-watch pane did not open: ' + (error instanceof Error ? error.message : String(error)) }
    }
    // Print nothing in the transcript
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    const data = bandData(await read($, main), await read($, totals), await read($, limits), await read($, limitsAt), now)
    if (data === null) return next(e)
    const E = $.ui.resolve(e) as unknown as Els
    // What the mods after this one draw in the band stays, below this line
    const theirs = await next(e)
    const line = bandEls(E, data, e.surface, e.props.bodyColumns)
    return (theirs ? E.Box({ flexDirection: 'column', children: [line, theirs] }) : line) as never
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
      body = sessionEls(E, { rows: rowsOf(t), total: sumAll(t), causes: await read($, causes), requestTimes: m.requestTimes, resumes: m.resumes, now, usd: await sessionCost($) }, e.props.bodyColumns, e.surface)
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
