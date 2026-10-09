import type { Ttl } from '../types'

export type Rates = { input: number; write5m: number; write1h: number; read: number; output: number }

// above: the rates of a request whose prompt (input, cache read and cache write) has more than `tokens` tokens
export type Price = Rates & { above?: { tokens: number; rates: Rates } }

// USD per million tokens. Source: https://platform.claude.com/docs/en/about-claude/pricing,
// read 2026-10-08. The match of the cache lifetime (matchLifetime) needs these prices to the cent: Claude Code books the same.
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-fable-5': { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-opus-5': { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  'claude-sonnet-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5, above: { tokens: 100_000, rates: { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 } } },
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

// The rates of a request with this many prompt tokens
export function ratesOf(price: Price, promptTokens: number): Rates {
  return price.above !== undefined && promptTokens > price.above.tokens ? price.above.rates : price
}

// The prompt of a request: input, cache read and cache write
export function promptOf(usage: UsageLike): number {
  return tokens(usage.input_tokens) + tokens(usage.cache_read_input_tokens) + tokens(usage.cache_creation_input_tokens)
}

// The cost of a request whose cache writes have the lifetime ttl
export function costOf(usage: UsageLike, ttl: Ttl): number {
  const price = priceOf(usage.model)
  if (!price) return 0
  const rates = ratesOf(price, promptOf(usage))
  return (
    (tokens(usage.input_tokens) * rates.input +
      tokens(usage.cache_creation_input_tokens) * (ttl === '5m' ? rates.write5m : rates.write1h) +
      tokens(usage.cache_read_input_tokens) * rates.read +
      tokens(usage.output_tokens) * rates.output) /
    1e6
  )
}

// The cost of the cache writes of a request
export function writeCostOf(usage: UsageLike, ttl: Ttl): number {
  const price = priceOf(usage.model)
  if (!price) return 0
  const rates = ratesOf(price, promptOf(usage))
  return (tokens(usage.cache_creation_input_tokens) * (ttl === '5m' ? rates.write5m : rates.write1h)) / 1e6
}

// What the next message costs to write the whole context again
export function rewarmCost(model: string, contextTokens: number, ttl: Ttl): number {
  return writeCostOf({ model, cache_creation_input_tokens: contextTokens }, ttl)
}

// Far below the smallest gap between the two prices of one request (a 1-token write of Haiku 5.5: 0.075 per million),
// and far above the rounding of the session cost (about 1e-13 for a session of 1000 USD)
const MATCH_TOLERANCE = 1e-9

// The lifetime whose price gives the cost that Claude Code booked for the request, or null.
// Claude Code books each request at the price of its real lifetime, so exactly one lifetime fits when booked holds this request alone.
// null when the request wrote nothing, when the model has no exact price (a fallback price is no evidence), and when none or both fit:
// a higher price (fast mode, US-only inference, a price of the organization) or another booking in the same reading
export function matchLifetime(usage: UsageLike, booked: number | null): Ttl | null {
  if (booked === null || !Number.isFinite(booked) || tokens(usage.cache_creation_input_tokens) === 0) return null
  if (priceInfo(usage.model)?.source !== 'exact') return null
  const fits = (['5m', '1h'] as const).filter((ttl) => Math.abs(costOf(usage, ttl) - booked) <= MATCH_TOLERANCE)
  return fits.length === 1 ? fits[0] : null
}
