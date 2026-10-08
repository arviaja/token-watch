import { mock } from 'claude-code/testing'

export const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
export const MIN = 60_000
export const RESETS_AT = '2026-10-11T09:00:00.000Z'
export const FABLE = { model: 'claude-fable-5-1', input_tokens: 2, output_tokens: 1000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 10_000 }
export const SONNET = { model: 'claude-sonnet-5-5', input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 30_000 }

export const BREAKDOWN = {
  totalTokens: 412_000,
  rawMaxTokens: 1_000_000,
  categories: [{ name: 'Messages', tokens: 318_000, kind: 'used' }],
  memoryFiles: [{ path: 'webshop/CLAUDE.md', type: 'Project', tokens: 9800 }],
  mcpTools: [{ name: 'list_issues', serverName: 'linear', tokens: 11_200, isLoaded: true }],
  agents: [],
}

// The reply of the stub of $.model.complete
export const REPLY_USAGE = { input_tokens: 2_400, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
export const REPLY = { isAnswered: true, text: '## Start a new session after a long pause\n\nTwo resumes wrote 412k tokens again.', usage: REPLY_USAGE }

let nextUsage: unknown = null

export type Harness = {
  store: Map<string, unknown>
  clock: ReturnType<typeof mock.clock>
  opened: unknown[]
  registered: unknown[]
  // Each request of $.model.complete. The stub answers it: no test makes a real model call
  modelCalls: any[]
  // Each pane that the mod closed
  closed: unknown[]
  // How often the mod listed the keys of the store
  keyCalls: { count: number }
  // How often the mod read the agent list
  agentListCalls: { count: number }
  // The text of each toast of the mod
  toasts: string[]
}

// Stubs for every mods API call and event the mod passes on, with a store in a Map
// Each failure is read at each call, so a test can turn it on after the start
export type Failures = { sessionId?: boolean; agentList?: boolean }

export function harness(on: any, options: { paneShown?: boolean; failStoreSet?: boolean; denyOpen?: boolean; openResult?: { deny: string } | { value: unknown }; store?: Record<string, unknown>; sessionModel?: string; fail?: Failures; modelResult?: { deny: string } | { value: unknown } | (($: any) => Promise<{ deny: string } | { value: unknown }>); breakdown?: unknown } = {}): Harness {
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const opened: unknown[] = []
  const registered: unknown[] = []
  const modelCalls: any[] = []
  const closed: unknown[] = []
  const keyCalls = { count: 0 }
  const toasts: string[] = []
  // The open panes by id, and whether each one is placed. An open adds its id, a close of the mod takes it away.
  // paneShown false stands for a pane that another pane covers
  const up = new Map<string, boolean>()
  const clock = mock.clock(on, { now: T0 })
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (options.failStoreSet) return { deny: 'store full' }
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => {
    keyCalls.count += 1
    return { value: [...store.keys()] }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.id', () => (options.fail?.sessionId ? { deny: 'no session id' } : { value: 'sess-1' }))
  on('session.model', () => ({ value: options.sessionModel ?? '' }))
  on('session.root', () => ({ value: '/Users/me/repos/webshop/.worktrees/fix-1-x' }))
  on('session.usage', (_$: unknown, e: { breakdown?: string } | undefined) => ({
    value: {
      context: { tokens: 0, window: 1_000_000, percent: 0, ...(e?.breakdown ? { breakdown: options.breakdown ?? BREAKDOWN } : {}) },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 41, resetsAt: RESETS_AT },
        { kind: 'five_hour', percentUsed: 12 },
      ],
      cost: { usd: 39.2 },
    },
  }))
  on('command.register', (_$: unknown, e: unknown) => {
    registered.push(e)
    return { value: undefined }
  })
  on('ui.open', (_$: unknown, e: unknown) => {
    if (options.denyOpen) return { deny: 'no pane' }
    if (options.openResult) {
      // A waiting pane is up, but not placed
      if ('value' in options.openResult) up.set((e as { id: string }).id, (options.openResult.value as { isPlaced?: boolean }).isPlaced !== false)
      return options.openResult
    }
    opened.push(e)
    up.set((e as { id: string }).id, true)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [...up].map(([id, isPlaced]) => ({ id, title: id, isShown: isPlaced && options.paneShown !== false, isFocused: true, isPlaced })) }))
  on('ui.close', (_$: unknown, e: unknown) => {
    closed.push(e)
    up.delete((e as { id: string }).id)
    return { value: undefined }
  })
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The stub of $.model.complete. It stands for the engine, so no request leaves the test
  // A function result runs at the call, for example to close the dialog while the call runs
  on('model.complete', async (_$: unknown, e: unknown) => {
    modelCalls.push(e)
    const result = options.modelResult
    if (typeof result === 'function') return result(_$)
    return result ?? { value: REPLY }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  // The agent list holds every agent that a test spawned
  const spawned: { id: string; type: string }[] = []
  on('agent.spawn', (_$: unknown, e: { subagentType: string }) => {
    spawned.push({ id: 'agent-' + e.subagentType, type: e.subagentType })
    return { model: 'claude-sonnet-5-5', agentId: 'agent-' + e.subagentType }
  })
  const agentListCalls = { count: 0 }
  on('agent.list', () => {
    agentListCalls.count += 1
    return options.fail?.agentList ? { deny: 'no agent list' } : { value: spawned.map((a) => ({ ...a, description: 'd', status: 'running' })) }
  })
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: nextUsage }
  })
  return { store, clock, opened, registered, modelCalls, closed, keyCalls, agentListCalls, toasts }
}

export async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

// Fires one model request and reads the stream to its end
export async function step($: any, usage: unknown, agentId?: string) {
  nextUsage = usage
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let part = await stream.next()
  while (part.done !== true) part = await stream.next()
  return part.value
}

export async function spawn($: any, subagentType: string) {
  return $.agent.spawn({
    tool_use_id: 'toolu-1',
    prompt: 'p',
    description: 'd',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-1',
  })
}

export async function complete($: any, agentId?: string) {
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, usage: null, ...(agentId ? { agentId } : {}) })
}

export async function end($: any) {
  await $.session.end({ reason: 'other', sessionId: 'sess-1' })
}

export function snapshotIn(store: Map<string, unknown>): any {
  const keys = [...store.keys()].filter((k) => k.startsWith('run:sess-1:'))
  return store.get(keys[keys.length - 1])
}
