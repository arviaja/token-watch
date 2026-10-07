import { expect, test } from 'claude-code/testing'
import { dayTime, limitItems } from '../hooks/format'
import { priceInfo } from '../hooks/prices'
import { DEFAULT_MODEL, OUTPUT_CAP, RECOMMEND_SYSTEM, agoText, drawableText, estimateTokens, failureText, maxCostOf, modelOption, priceModelOf, priceSourceOf, recommendPrompt, type RecommendInput } from '../hooks/recommend'
import { NO_CAUSES, addCause, addTo, countsOf } from '../hooks/tally'
import type { WeekData } from '../hooks/view'

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const FABLE = { model: 'claude-fable-5-1', input_tokens: 6, output_tokens: 1400, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 12_000 }
const SONNET = { model: 'claude-sonnet-5-5', input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 30_000 }
const RESETS_AT = '2026-10-11T09:00:00.000Z'

const NO_WEEK: WeekData = { percent: null, resetAt: null, projection: '', start: T0 - 7 * 24 * HOUR, history: [], byRepo: [], byModelScope: [], total: 0 }
const EMPTY: RecommendInput = { now: T0, totals: {}, causes: NO_CAUSES, usd: null, requestTimes: [], resumes: [], limits: [], limitsAt: null, week: NO_WEEK, breakdown: null }

function full(): RecommendInput {
  let totals = addTo({}, 'claude-fable-5-1', 'main', countsOf(FABLE, 3))
  totals = addTo(totals, 'claude-sonnet-5-5', 'Explore', countsOf(SONNET, 1))
  let causes = addCause(NO_CAUSES, 'start', 12_000, 0.25)
  causes = addCause(causes, 'resume', 400_000, 0.75)
  const week: WeekData = {
    percent: 41,
    resetAt: Date.parse(RESETS_AT),
    projection: '100% on Fri 16:00',
    start: Date.parse(RESETS_AT) - 7 * 24 * HOUR,
    history: [
      { char: '░', percent: null, isFuture: false },
      { char: '▃', percent: 33, isFuture: false },
      { char: ' ', percent: null, isFuture: true },
    ],
    byRepo: [
      { name: 'webshop', cost: 30 },
      { name: 'billing-service', cost: 10 },
    ],
    byModelScope: [
      { name: 'fable-5-1 main', cost: 30 },
      { name: 'mythos-1 main', cost: 0, isUnpriced: true },
    ],
    total: 40,
  }
  return {
    now: T0,
    totals,
    causes,
    usd: 5.5,
    requestTimes: [T0 - 100 * MIN, T0 - 5 * MIN],
    resumes: [{ at: T0 - 5 * MIN, cost: 0.75 }],
    limits: [
      { kind: 'five_hour', percentUsed: 12 },
      { kind: 'seven_day', percentUsed: 41, resetsAt: RESETS_AT },
    ],
    limitsAt: T0 - 3 * HOUR,
    week,
    breakdown: { total: 412_000, max: 1_000_000, categories: [{ name: 'Messages', tokens: 318_000 }], memoryFiles: [{ name: 'webshop/CLAUDE.md', tokens: 9_800 }], mcpServers: [{ name: 'tracker', tokens: 11_200 }], agents: [] },
  }
}

test('an alias is priced as its family and keeps its name, and a full id stays as it is', async () => {
  expect(priceModelOf('sonnet')).toBe('claude-sonnet')
  expect(priceModelOf(' opus ')).toBe('claude-opus')
  expect(priceModelOf('claude-opus-5-5')).toBe('claude-opus-5-5')
  // The alias takes the price of the newest model of its family in the table, so its cost is an estimate
  expect(priceInfo('claude-sonnet')?.source).toBe('fallback')
  expect(priceSourceOf('claude-sonnet')).toBe('sonnet-5-5')
  expect(priceSourceOf('claude-opus-5-5')).toBe('opus-5-5')
  expect(priceSourceOf('claude-mythos')).toBeUndefined()
})

test('the model comes from the option recommendModel, and sonnet when the option is empty or not a text', async () => {
  expect(DEFAULT_MODEL).toBe('sonnet')
  expect(modelOption(undefined)).toBe('sonnet')
  expect(modelOption({})).toBe('sonnet')
  expect(modelOption({ recommendModel: '  ' })).toBe('sonnet')
  expect(modelOption({ recommendModel: 3 })).toBe('sonnet')
  expect(modelOption({ recommendModel: ' opus ' })).toBe('opus')
  expect(modelOption({ recommendModel: 'Sonnet' })).toBe('sonnet')
  expect(modelOption({ recommendModel: 'Claude-Opus-5-5' })).toBe('claude-opus-5-5')
})

test('the input estimate is 1 token for every 3 characters, rounded up', async () => {
  expect(estimateTokens('')).toBe(0)
  expect(estimateTokens('abc')).toBe(1)
  expect(estimateTokens('abcdefg')).toBe(3)
  // A character outside the basic plane counts once
  expect(estimateTokens('≈≈≈')).toBe(1)
})

test('the highest cost is the input estimate and the full output cap at API prices, and null without a price', async () => {
  expect(OUTPUT_CAP).toBe(4000)
  // sonnet-5-5: input 2 and output 10 dollars per million tokens
  const cents = (x: number | null) => (x === null ? null : Math.round(x * 1e6))
  expect(cents(maxCostOf(priceInfo('claude-sonnet'), 1200, 4000))).toBe(1200 * 2 + 4000 * 10)
  expect(cents(maxCostOf(priceInfo('claude-opus-5-5'), 1000, 4000))).toBe(1000 * 4 + 4000 * 20)
  expect(maxCostOf(undefined, 1200, 4000)).toBeNull()
})

test('a call without a reply has one sentence for each reason', async () => {
  expect(failureText({ reason: 'api-error', status: 429, error: 'rate_limit' })).toBe('The API answered with an error: rate_limit (HTTP 429).')
  expect(failureText({ reason: 'api-error', status: null, error: 'unknown' })).toBe('The API answered with an error: unknown (no response).')
  expect(failureText({ reason: 'empty-reply' })).toBe('The model sent a reply without text.')
  expect(failureText({ reason: 'aborted' })).toBe('The call stopped before the reply: it was cancelled, or no reply came within 2 minutes.')
  expect(failureText({})).toBe('The call gave no reply.')
})

test('a time ago reads in minutes, then in hours and minutes', async () => {
  expect(agoText(0)).toBe('0 min ago')
  expect(agoText(25 * MIN)).toBe('25 min ago')
  expect(agoText(60 * MIN)).toBe('1 h ago')
  expect(agoText(192 * MIN)).toBe('3 h 12 min ago')
})

test('the system prompt names the four levers and the rules of the answer', async () => {
  for (const lever of ['Resume or new session', 'Memory files and MCP servers', 'Model choice', 'Subagents']) expect(RECOMMEND_SYSTEM).toContain('- ' + lever + '.')
  expect(RECOMMEND_SYSTEM).toContain('It holds no conversation text.')
  expect(RECOMMEND_SYSTEM).toContain('On a subscription the plan allowance counts')
  expect(RECOMMEND_SYSTEM).toContain('Write Markdown')
})

test('the prompt holds the data of the tabs in fixed sections', async () => {
  const prompt = recommendPrompt(full())
  const sections = prompt.split('\n').filter((l) => l.startsWith('## '))
  expect(sections).toEqual([
    '## Plan limits',
    '## This conversation, by model and scope',
    '## Cache writes of this conversation, by cause',
    '## Cache history of this conversation',
    '## Context of this conversation',
    '## This week',
    '## API list prices in USD per million tokens',
  ])
  expect(prompt.startsWith('token-watch data, read ' + dayTime(T0) + ' (local time).')).toBe(true)
  // The limits in the order week, 5h, with the reset, the time of 100% at the current pace, and the age of an old reading
  const full100 = limitItems(full().limits, full().limitsAt, T0)[0].projection.replace(' → 100% ', '')
  expect(full100).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/)
  expect(prompt).toContain('- week 41% used, resets ' + dayTime(Date.parse(RESETS_AT)) + ', 100% at the current pace on ' + full100 + '\n- 5h 12% used\nLast reading: 3h ago.')
  expect(prompt).toContain('- fable-5-1 main: 1 request, input 6, cache write 12.0k, cache read 400k, output 1.4k, $3.00 (75%)')
  expect(prompt).toContain('- sonnet-5-5 Explore: 1 request, input 5, cache write 30.0k, cache read 20.0k, output 300, $1.00 (25%)')
  expect(prompt).toContain('Total: $4.00. /cost reports $5.50.')
  expect(prompt).toContain('- resume (after a pause longer than the cache life): 400k tokens, $0.75, 75%')
  expect(prompt).toContain('Main requests in the last 4 hours: 2.')
  expect(prompt).toContain('Resumes in the last 4 hours: 5 min ago, cache write $0.75.')
  // The strip: one letter for each 5 minutes of the last 4 hours
  const strip = prompt.split('\n').find((l) => /^[Wc.]{48}$/.test(l))
  expect(strip).toBeDefined()
  expect(strip!.endsWith('W')).toBe(true)
  expect(prompt).toContain('Context: 412k of 1.0M (41%)\n- Messages 318k (77%)')
  expect(prompt).toContain('Largest memory files: webshop/CLAUDE.md 9.8k (2%)')
  expect(prompt).toContain('MCP servers: tracker 11.2k (3%)')
  expect(prompt).not.toContain('Custom agents:')
  expect(prompt).toContain('Weekly limit: 41% used, resets ' + dayTime(Date.parse(RESETS_AT)) + ', at the current rate 100% on Fri 16:00.')
  // The past periods only: a future period has no value yet
  expect(prompt).toContain('Highest weekly percent of each 12 hours, oldest first: no reading, 33%.')
  expect(prompt).toContain('Cost by repo: webshop $30.00 (75%), billing-service $10.00 (25%).')
  expect(prompt).toContain('Cost by model and scope: fable-5-1 main $30.00 (75%), mythos-1 main no price.')
  expect(prompt).toContain('- sonnet-5-5: input 2, cache write 4 (1 hour) or 2.5 (5 minutes), cache read 0.2, output 10')
  expect(prompt.endsWith('\n')).toBe(false)
})

test('a prompt without data says so in each section', async () => {
  const prompt = recommendPrompt(EMPTY)
  expect(prompt).toContain('## Plan limits\nNo limit reading.')
  expect(prompt).toContain('No model request in this conversation yet.')
  expect(prompt).toContain('Resumes in the last 4 hours: none.')
  expect(prompt).toContain('## Context of this conversation\nNot available.')
  expect(prompt).toContain('Weekly limit: no reading.')
  expect(prompt).toContain('Cost by repo: none.')
})

test('a cost from a fallback price names the price that it uses, and a model without a price says so', async () => {
  const totals = addTo(addTo({}, 'claude-opus-5-6', 'main', countsOf({ ...FABLE, model: 'claude-opus-5-6' }, 2)), 'claude-mythos-1', 'main', countsOf({ ...FABLE, model: 'claude-mythos-1' }, 0))
  const prompt = recommendPrompt({ ...EMPTY, totals })
  expect(prompt).toContain('opus-5-6 main: 1 request, input 6, cache write 12.0k, cache read 400k, output 1.4k, $2.00 (price of opus-5-5) (100%)')
  expect(prompt).toContain('mythos-1 main: 1 request, input 6, cache write 12.0k, cache read 400k, output 1.4k, no price (0%)')
})

test('a text for the dialog loses its control characters and is cut at 10000 characters with a note', async () => {
  expect(drawableText('## One\r\n\nText\twith a tab.')).toBe('## One\n\nText\twith a tab.')
  expect(drawableText('a\u0000b\u001bc\u007fd')).toBe('abcd')
  const short = 'x'.repeat(10_000)
  expect(drawableText(short)).toBe(short)
  const long = drawableText('y'.repeat(12_000))
  expect(long.length).toBeLessThanOrEqual(10_000)
  expect(long.endsWith('\n\n… (cut at 10,000 characters)')).toBe(true)
  // A character outside the basic plane stays whole at the cut
  const emoji = drawableText('\u{1F600}'.repeat(6_000))
  expect(emoji.length).toBeLessThanOrEqual(10_000)
  expect(emoji.replace('\n\n… (cut at 10,000 characters)', '').length % 2).toBe(0)
})
