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

export type Main = {
  model: string
  lastRequestAt: number | null
  contextTokens: number
  isWorking: boolean
  requestTimes: number[]
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
      hours: Hours
      tab: number
      breakdown: Breakdown | null
      others: Snapshot[]
    }
  }
}
