export type Price = { input: number; write5m: number; write1h: number; read: number; output: number }

// USD per million tokens. Source: https://platform.claude.com/docs/en/about-claude/pricing,
// read 2026-09-29.
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-fable-5': { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-opus-5': { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'claude-sonnet-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'claude-haiku-4-5': { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 },
}

export type UsageLike = {
  model: string
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// The price source of a model: `exact` when the table has the model, `fallback` when the price is the one of the newest model of the same family
export type PriceInfo = { price: Price; source: 'exact' | 'fallback'; from?: string }

// The id without a context suffix (`[1m]`) and without a date suffix (`-20251001`)
export function baseModel(model: string): string {
  return model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
}

// The family of a model id is the word after `claude-`: `opus` for `claude-opus-5-5`. An id of another form has none
export function familyOf(model: string): string | undefined {
  return /^claude-([^-]+)/.exec(model)?.[1]
}

// The version of a model id is the numbers after the family: `claude-opus-5-5` is [5, 5]
export function versionOf(model: string): number[] {
  return model
    .replace(/^claude-[^-]+-?/, '')
    .split('-')
    .filter((part) => part !== '')
    .map((part) => parseInt(part, 10) || 0)
}

// Compares two versions number by number. A missing part counts as 0, so [5] equals [5, 0]. Returns a number below 0, 0 or above 0
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// The key of the newest model of a family in the table, or undefined when the family has none
export function newestOf(family: string): string | undefined {
  let newest: string | undefined
  for (const key of Object.keys(PRICES)) {
    if (familyOf(key) !== family) continue
    if (newest === undefined || compareVersions(versionOf(key), versionOf(newest)) > 0) newest = key
  }
  return newest
}

export function priceInfo(model: string): PriceInfo | undefined {
  const base = baseModel(model)
  const exact = Object.prototype.hasOwnProperty.call(PRICES, base) ? PRICES[base] : undefined
  if (exact !== undefined) return { price: exact, source: 'exact' }
  const family = familyOf(base)
  const from = family === undefined ? undefined : newestOf(family)
  const price = from === undefined ? undefined : PRICES[from]
  return from === undefined || price === undefined ? undefined : { price, source: 'fallback', from }
}

// The exact price, or the fallback price of the newest model of the family
export function priceOf(model: string): Price | undefined {
  return priceInfo(model)?.price
}

// Main conversations write the cache with a 1-hour lifetime, subagents with a 5-minute lifetime
export function costOf(usage: UsageLike, isSubagent: boolean): number {
  const price = priceOf(usage.model)
  if (!price) return 0
  const write = isSubagent ? price.write5m : price.write1h
  return (
    (tokens(usage.input_tokens) * price.input +
      tokens(usage.cache_creation_input_tokens) * write +
      tokens(usage.cache_read_input_tokens) * price.read +
      tokens(usage.output_tokens) * price.output) /
    1e6
  )
}

export function writeCostOf(model: string, cacheWriteTokens: number, isSubagent: boolean): number {
  const price = priceOf(model)
  if (!price) return 0
  return (tokens(cacheWriteTokens) * (isSubagent ? price.write5m : price.write1h)) / 1e6
}

export function rewarmCost(model: string, contextTokens: number): number {
  return writeCostOf(model, contextTokens, false)
}
