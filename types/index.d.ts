export type Counts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
  cost: number
}

export type Totals = Record<string, Record<string, Counts>>

export type Hours = Record<string, Record<string, Counts>>

export type Cause = 'start' | 'growth' | 'resume'

export type Causes = Record<Cause, { tokens: number; cost: number }>

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// at: the first measure of the percent. seenAt: the last measure that kept the percent within a whole point, when it came after at
export type Reading = { at: number; kind: string; percentUsed: number; resetsAt?: string; seenAt?: number }

export type Resume = { at: number; cost: number }

// The lifetime of a cache write: 5 minutes or 1 hour
export type Ttl = '5m' | '1h'

// The lifetime of the cache writes of one scope (main, or a subagent type), read from the cost that Claude Code books for each request.
// known: the confirmed lifetime, or null before the first match. pending: a match that differs from known. A second match in a row confirms it
export type Lifetime = { known: Ttl | null; pending: Ttl | null }

// A main request of the last 4 hours, with the lifetime that its cost used
export type MainRequest = { at: number; ttl: Ttl }

export type Main = {
  model: string
  lastRequestAt: number | null
  // The confirmed lifetime of the cache of the last main request, or null when the mod does not know it
  ttl: Ttl | null
  contextTokens: number
  isWorking: boolean
  requests: MainRequest[]
  resumes: Resume[]
}

export type Run = { sessionId: string; startedAt: number; repo: string }

export type Snapshot = {
  v: 1
  key: string
  sessionId: string
  repo: string
  model: string
  updatedAt: number
  lastMainRequestAt: number | null
  // The ttl of Main. A snapshot of an older version has none and counts as unknown
  mainTtl?: Ttl | null
  contextTokens: number
  isWorking: boolean
  readings: Reading[]
  hours: Hours
}

export type BreakdownRow = { name: string; tokens: number }

export type Breakdown = {
  total: number
  max: number
  categories: BreakdownRow[]
  memoryFiles: BreakdownRow[]
  mcpServers: BreakdownRow[]
  agents: BreakdownRow[]
}

// The dialog of /token-watch recommend. confirm: the cost shows and no call ran. asking: the call runs. answered: the reply shows. failed: the call gave no reply.
// model is the model as configured, an alias or an id. priceModel is the id that prices the call and that the totals use: `claude-sonnet` for the alias `sonnet`
export type RecommendPhase = 'confirm' | 'asking' | 'answered' | 'failed'

export type Recommend = {
  id: number
  phase: RecommendPhase
  model: string
  priceModel: string
  prompt: string
  inputTokens: number
  outputCap: number
  // The highest cost at API prices, or null for a model without a price
  maxCost: number | null
  // The reply as Markdown, or the reason of a failure
  text: string
  // The counted usage of the call, after it ran
  counts: Counts | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-watch': {
      run: Run | null
      totals: Totals
      causes: Causes
      main: Main
      limits: Limit[]
      limitsAt: number | null
      readings: Reading[]
      agents: Record<string, string>
      threads: Record<string, number>
      // The lifetime of the last request of each thread, so that the gap to the next request is compared with the lifetime of the cache that it can read
      threadTtls: Record<string, Ttl>
      // The lifetime of each scope: main, or a subagent type
      lifetimes: Record<string, Lifetime>
      hours: Hours
      tab: number
      breakdown: Breakdown | null
      others: Snapshot[]
      recommend: Recommend | null
      // The copy of this session of the band setting in the store. The tick reads the store again
      isBandOn: boolean
      // The pane of /token-watch is open. The band button reads it for its label
      isPaneOpen: boolean
      // The × of the band hid it in this session. /token-watch band on clears it
      isBandHidden: boolean
    }
  }
}
