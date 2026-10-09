import { expect, test } from 'claude-code/testing'
import { PRICES, compareVersions, costOf, familyOf, newestOf, priceInfo, priceOf, rewarmCost, tokens, versionOf, writeCostOf } from '../hooks/prices'
import { PRICE_KEYS, collectModels, reportLines, statusOf } from '../scripts/price-rule.mjs'
import { matchLifetime } from '../hooks/prices'

function close(actual: number, expected: number) {
  expect(Math.abs(actual - expected) < 1e-9).toBe(true)
}

test('priceOf finds a model with a date or context suffix', async () => {
  expect(priceOf('claude-opus-5-5')?.write1h).toBe(8)
  expect(priceOf('claude-haiku-4-5-20251001')?.input).toBe(1)
  expect(priceOf('claude-opus-5-5[1m]')?.read).toBe(0.2)
  expect(priceOf('gpt-6-sol')).toBeUndefined()
})

test('costOf prices a main request with the 1-hour write price', async () => {
  const usage = {
    model: 'claude-fable-5-1',
    input_tokens: 1000,
    output_tokens: 2000,
    cache_read_input_tokens: 4_000_000,
    cache_creation_input_tokens: 100_000,
  }
  close(costOf(usage, '1h'), 3.11)
})

test('costOf prices a subagent request with the 5-minute write price', async () => {
  close(costOf({ model: 'claude-sonnet-5-5', cache_creation_input_tokens: 1_000_000 }, '5m'), 2.5)
})

test('costOf counts bad fields as 0 and an unknown model as 0', async () => {
  const usage = {
    model: 'claude-opus-5-5',
    input_tokens: null,
    output_tokens: -5,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: undefined,
  }
  close(costOf(usage, '1h'), 0.2)
  expect(costOf({ model: 'unknown-model', input_tokens: 1000 }, '1h')).toBe(0)
  expect(tokens('12')).toBe(0)
  expect(tokens(Number.NaN)).toBe(0)
})

test('writeCostOf and rewarmCost use the cache write prices', async () => {
  close(writeCostOf({ model: 'claude-opus-5-5', cache_creation_input_tokens: 1_000_000 }, '1h'), 8)
  close(writeCostOf({ model: 'claude-opus-5-5', cache_creation_input_tokens: 1_000_000 }, '5m'), 5)
  close(rewarmCost('claude-fable-5-1', 412_000, '1h'), 8.24)
  expect(rewarmCost('unknown-model', 412_000, '1h')).toBe(0)
})

test('compareVersions compares number by number and counts a missing part as 0', async () => {
  expect(compareVersions([5, 5], [5])).toBeGreaterThan(0)
  expect(compareVersions([5], [4, 8])).toBeGreaterThan(0)
  expect(compareVersions([4, 8], [5])).toBeLessThan(0)
  expect(compareVersions([5], [5, 0])).toBe(0)
  expect(compareVersions([5, 0, 0], [5])).toBe(0)
  // Numbers, not text: 10 is above 9
  expect(compareVersions([5, 10], [5, 9])).toBeGreaterThan(0)
  expect(compareVersions([], [])).toBe(0)
})

test('familyOf and versionOf read the word and the numbers after claude-', async () => {
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('claude-mythos-1')).toBe('mythos')
  expect(familyOf('claude-opus')).toBe('opus')
  expect(familyOf('gpt-6-sol')).toBeUndefined()
  expect(versionOf('claude-opus-5-5')).toEqual([5, 5])
  expect(versionOf('claude-opus-5')).toEqual([5])
  expect(versionOf('claude-opus')).toEqual([])
})

test('newestOf takes the highest version of a family from the table', async () => {
  expect(newestOf('opus')).toBe('claude-opus-5-5')
  expect(newestOf('sonnet')).toBe('claude-sonnet-5-5')
  expect(newestOf('fable')).toBe('claude-fable-5-1')
  expect(newestOf('haiku')).toBe('claude-haiku-5-5')
  expect(newestOf('mythos')).toBeUndefined()
})

test('priceInfo returns an exact price with its source, also for a date or context suffix', async () => {
  expect(priceInfo('claude-opus-5-5')).toEqual({ price: PRICES['claude-opus-5-5'], source: 'exact' })
  expect(priceInfo('claude-opus-5')).toEqual({ price: PRICES['claude-opus-5'], source: 'exact' })
  expect(priceInfo('claude-haiku-4-5-20251001')).toEqual({ price: PRICES['claude-haiku-4-5'], source: 'exact' })
  expect(priceInfo('claude-opus-5-5[1m]')).toEqual({ price: PRICES['claude-opus-5-5'], source: 'exact' })
  expect(priceInfo('claude-opus-5-5-20260101[1m]')?.source).toBe('exact')
})

test('a new model uses the price of the newest model of its family', async () => {
  expect(priceInfo('claude-opus-5-6')).toEqual({ price: PRICES['claude-opus-5-5'], source: 'fallback', from: 'claude-opus-5-5' })
  // A model below the newest key of its family also uses the newest key
  expect(priceInfo('claude-opus-4-9')).toEqual({ price: PRICES['claude-opus-5-5'], source: 'fallback', from: 'claude-opus-5-5' })
  expect(priceInfo('claude-sonnet-6')).toEqual({ price: PRICES['claude-sonnet-5-5'], source: 'fallback', from: 'claude-sonnet-5-5' })
  expect(priceInfo('claude-fable-5-2')).toEqual({ price: PRICES['claude-fable-5-1'], source: 'fallback', from: 'claude-fable-5-1' })
  expect(priceInfo('claude-haiku-4-6-20260101')?.from).toBe('claude-haiku-5-5')
  expect(priceInfo('claude-opus-5-6[1m]')?.from).toBe('claude-opus-5-5')
  expect(priceOf('claude-opus-5-6')).toEqual(PRICES['claude-opus-5-5'])
})

test('a model of a family without a key, or without the claude- prefix, has no price', async () => {
  expect(priceInfo('claude-mythos-1')).toBeUndefined()
  expect(priceOf('claude-mythos-1')).toBeUndefined()
  expect(priceInfo('gpt-6-sol')).toBeUndefined()
  expect(priceInfo('')).toBeUndefined()
  // The legacy form claude-3-5-haiku has the number after claude-, so it has no family key
  expect(priceInfo('claude-3-5-haiku-20241022')).toBeUndefined()
  // Names of Object.prototype are not models
  expect(priceInfo('constructor')).toBeUndefined()
  expect(priceInfo('__proto__')).toBeUndefined()
})

test('costOf, writeCostOf and rewarmCost use the fallback price', async () => {
  const usage = { model: 'claude-opus-5-6', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }
  // claude-opus-5-5: input 4, write1h 8, write5m 5, read 0.2, output 20
  close(costOf(usage, '1h'), 4 + 8 + 0.2 + 20)
  close(costOf(usage, '5m'), 4 + 5 + 0.2 + 20)
  close(costOf({ ...usage, model: 'claude-sonnet-6' }, '1h'), 2 + 4 + 0.1 + 10)
  close(writeCostOf({ model: 'claude-opus-4-9', cache_creation_input_tokens: 1_000_000 }, '1h'), 8)
  close(writeCostOf({ model: 'claude-opus-4-9', cache_creation_input_tokens: 1_000_000 }, '5m'), 5)
  close(rewarmCost('claude-opus-5-6', 412_000, '1h'), 3.296)
  expect(costOf({ ...usage, model: 'claude-mythos-1' }, '1h')).toBe(0)
  expect(rewarmCost('claude-mythos-1', 412_000, '1h')).toBe(0)
})

// The models of the check are the cases of the rule: exact, fallback by a higher and a lower version, a suffix, other families and no family
const RULE_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-opus-5-6', 'claude-opus-4-9', 'claude-sonnet-6', 'claude-fable-5-2', 'claude-haiku-4-5-20251001', 'claude-haiku-4-6-20260101', 'claude-opus-5-5[1m]', 'claude-opus-4-9[1m]', 'claude-mythos-1', 'claude-3-5-haiku-20241022', 'gpt-6-sol', '']

test('scripts/price-rule.mjs gives the same answer as priceInfo for the same table', async () => {
  const keys = Object.keys(PRICES)
  for (const model of RULE_MODELS) {
    const info = priceInfo(model)
    const status = statusOf(model, keys)
    expect(status.source, model).toBe(info === undefined ? 'unpriced' : info.source)
    expect(status.from, model).toBe(info?.from)
  }
})

// The price report reads no file of the mod, so its copy of the keys must follow the table
test('PRICE_KEYS of scripts/price-rule.mjs holds the keys of PRICES, in the same order', async () => {
  expect(PRICE_KEYS).toEqual(Object.keys(PRICES))
})

test('collectModels finds the model fields and the model part of the hour bucket keys', async () => {
  const store = {
    'run:a:1': { v: 1, model: 'claude-opus-5-6', hours: { '2026-10-06T14': { 'claude-opus-5-6|main': {}, 'claude-sonnet-6|Explore|x': {} } } },
    'run:b:1': { v: 1, model: '', hours: { '2026-10-06T15': { 'claude-haiku-4-5-20251001|main': {}, 'bare-model': {} } } },
    'run:c:1': { v: 1, model: 3, hours: 'bad' },
  }
  expect([...collectModels(store)].sort()).toEqual(['bare-model', 'claude-haiku-4-5-20251001', 'claude-opus-5-6', 'claude-sonnet-6'])
  expect(collectModels(null).size).toBe(0)
})

test('reportLines gives one sorted line for each model and a summary', async () => {
  const keys = Object.keys(PRICES)
  const lines = reportLines(new Set(['claude-sonnet-6', 'claude-opus-5-5', 'claude-mythos-1']), keys, 2)
  expect(lines).toEqual([
    'claude-mythos-1  unpriced',
    'claude-opus-5-5  exact',
    'claude-sonnet-6  fallback from claude-sonnet-5-5',
    '3 models in 2 store files: 1 exact, 1 fallback, 1 unpriced',
  ])
  // The price model of /token-watch recommend has no version: it is an alias, not a missing key
  expect(reportLines(new Set(['claude-opus-5-5', 'claude-sonnet']), keys, 1)).toEqual(['claude-opus-5-5  exact', 'claude-sonnet    alias, priced as claude-sonnet-5-5', '2 models in 1 store file: 1 exact, 0 fallback, 0 unpriced, 1 alias'])
  expect(reportLines(new Set(['claude-opus-5-5']), keys, 1)).toEqual(['claude-opus-5-5  exact', '1 model in 1 store file: 1 exact, 0 fallback, 0 unpriced'])
  expect(reportLines(new Set(), keys, 1)).toEqual(['0 models in 1 store file: 0 exact, 0 fallback, 0 unpriced'])
})

test('Sonnet 5.5 reads the cache at 0.10, and Haiku 5.5 has a higher price for a prompt above 100,000 tokens', async () => {
  expect(PRICES['claude-sonnet-5-5'].read).toBe(0.1)
  const at = (prompt: number) => ({ model: 'claude-haiku-5-5', input_tokens: prompt, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  close(costOf(at(100_000), '1h'), (100_000 * 0.1 + 1_000_000 * 0.5) / 1e6)
  // Above 100,000 every token has the higher price, the output too
  close(costOf(at(100_001), '1h'), (100_001 * 0.5 + 1_000_000 * 2.5) / 1e6)
  // The prompt counts the cache read and the cache write too
  const mixed = { model: 'claude-haiku-5-5', input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 40_000 }
  close(costOf(mixed, '5m'), (1 * 0.5 + 60_000 * 0.05 + 40_000 * 0.625) / 1e6)
  close(rewarmCost('claude-haiku-5-5', 100_000, '1h'), 0.02)
  close(rewarmCost('claude-haiku-5-5', 412_000, '1h'), 0.412)
})

test('matchLifetime finds the cache life whose price gives the booked cost', async () => {
  // Haiku 5.5 at 1 hour: 2 x 0.1 + 25,111 x 0.01 + 28,644 x 0.2 + 79 x 0.5 = 6019.61 per million
  const usage = { model: 'claude-haiku-5-5', input_tokens: 2, output_tokens: 79, cache_read_input_tokens: 25_111, cache_creation_input_tokens: 28_644 }
  expect(matchLifetime(usage, 0.00601961)).toBe('1h')
  // At 5 minutes: the write at 0.125 gives 3871.31 per million
  expect(matchLifetime(usage, 0.00387131)).toBe('5m')
  expect(matchLifetime({ ...usage, model: 'claude-haiku-5-5[1m]' }, 0.00601961)).toBe('1h')
  // The rounding of a large session cost stays inside the tolerance
  expect(matchLifetime(usage, 1234.56789 + 0.00601961 - 1234.56789)).toBe('1h')
})

test('matchLifetime finds no cache life when another booking, a higher price or a missing price is in the cost', async () => {
  const usage = { model: 'claude-haiku-5-5', input_tokens: 2, output_tokens: 79, cache_read_input_tokens: 25_111, cache_creation_input_tokens: 28_644 }
  // Another request in the same reading, fast mode at twice the price, no reading
  expect(matchLifetime(usage, 0.00601961 + 0.0001)).toBeNull()
  expect(matchLifetime(usage, 2 * 0.00601961)).toBeNull()
  expect(matchLifetime(usage, null)).toBeNull()
  expect(matchLifetime(usage, Number.NaN)).toBeNull()
  // A request that wrote nothing costs the same for both lives
  expect(matchLifetime({ ...usage, cache_creation_input_tokens: 0 }, (2 * 0.1 + 25_111 * 0.01 + 79 * 0.5) / 1e6)).toBeNull()
  // A fallback price is no evidence: a new model can have other prices
  expect(matchLifetime({ ...usage, model: 'claude-haiku-5-6' }, 0.00601961)).toBeNull()
  expect(matchLifetime({ ...usage, model: 'unknown-model' }, 0.00601961)).toBeNull()
})
