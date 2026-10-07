import type { Breakdown, Causes, Limit, Resume, Totals } from '../types'
import { dayTime, formatMoney, formatPercent, formatTokens, limitItems, limitsAgeText, shortModel } from './format'
import { PRICES, familyOf, newestOf, priceInfo, type PriceInfo } from './prices'
import { stripCells } from './temperature'
import { STRIP_MS, rowsOf, sumAll } from './tally'
import type { WeekData } from './view'

// The scope of the call in the totals: the Session and the Week tab show its cost under this name
export const RECOMMEND_SCOPE = 'recommend'
// The model of the call when the userConfig option is empty. The alias resolves like --model, so it follows each new Sonnet release
export const DEFAULT_MODEL = 'sonnet'
// The token cap of the reply. The highest cost counts the full cap
export const OUTPUT_CAP = 4000
// The input estimate: 1 token for every 3 characters of the prompt and the system prompt. Data text with many numbers has short tokens
export const CHARS_PER_TOKEN = 3
// The longest wait for the reply
export const RECOMMEND_TIMEOUT_MS = 120_000
// How hard the model thinks. Thinking tokens count in the output cap, so a high effort could leave no room for the reply
export const RECOMMEND_EFFORT = 'medium'
// The most rows of each Week table in the prompt
const WEEK_ROWS = 10
// A Markdown or a Text holds at most 10000 characters, and tab and newline are its only control characters
const MAX_TEXT = 10_000
const CUT_NOTE = '\n\n… (cut at 10,000 characters)'

export const RECOMMEND_SYSTEM = [
  'You give advice on the Claude Code usage of one person. The data comes from token-watch, a Claude Code mod that counts the tokens of the sessions on this computer. The data holds token counts, costs, plan limits and the names of repos, memory files, MCP servers and agents. It holds no conversation text.',
  '',
  'Give at most 5 recommendations that lower the cost and the use of the plan allowance. Use only these levers, which the person controls:',
  '- Resume or new session. A message after a pause longer than the cache life writes the whole context to the cache again: a resume. A new session starts with a small context.',
  '- Memory files and MCP servers. Their tokens go into every request.',
  '- Model choice. A smaller model has a lower price for each token.',
  '- Subagents. A subagent works in a context of its own, and its cache expires after 5 minutes.',
  '',
  'Rules:',
  '- Base each recommendation on figures in the data, and name them.',
  '- Give the expected saving as a figure when the data allows it.',
  '- When the data shows no problem for a lever, give no recommendation for it.',
  '- Every cost is an estimate at API list prices. On a subscription the plan allowance counts, not the dollars: use the costs to compare.',
  '- Write Markdown: a heading for each recommendation, then at most three sentences. Put the largest saving first. No table. At most 300 words.',
].join('\n')

export type RecommendInput = {
  now: number
  totals: Totals
  causes: Causes
  // The cost that Claude Code reports with /cost, or null
  usd: number | null
  requestTimes: number[]
  resumes: Resume[]
  limits: Limit[]
  limitsAt: number | null
  week: WeekData
  breakdown: Breakdown | null
}

// The four token counts of a model call, as the API spells them
export type CallUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// The result of the call when it gave no reply: the reason, and for an API error its kind and HTTP status
export type CallFailure = { reason?: string; status?: number | null; error?: string }

// The model of the call: the userConfig option `recommendModel`, or the default when it is empty.
// The option is free text, and model ids are lower case, so `Sonnet` counts as `sonnet`
export function modelOption(options: unknown): string {
  const value = typeof options === 'object' && options !== null ? (options as Record<string, unknown>).recommendModel : undefined
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : DEFAULT_MODEL
}

// Why the call gave no reply, as one sentence for the dialog
export function failureText(r: CallFailure): string {
  if (r.reason === 'api-error') return 'The API answered with an error: ' + (r.error ?? 'unknown') + (typeof r.status === 'number' ? ' (HTTP ' + r.status + ').' : ' (no response).')
  if (r.reason === 'empty-reply') return 'The model sent a reply without text.'
  if (r.reason === 'aborted') return 'The call stopped before the reply: it was cancelled, or no reply came within 2 minutes.'
  return 'The call gave no reply.'
}

// A text that the dialog can draw: carriage returns and other control characters out, and at most 10000 characters.
// A longer reply is cut, with a note, because the engine refuses a tree with a longer text and closes the pane
export function drawableText(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  if (clean.length <= MAX_TEXT) return clean
  let cut = ''
  for (const char of Array.from(clean)) {
    if (cut.length + char.length > MAX_TEXT - CUT_NOTE.length) break
    cut += char
  }
  return cut + CUT_NOTE
}

// The id that prices the call and that the totals use. An alias has no version, so `sonnet` becomes `claude-sonnet`:
// the price is the one of the newest Sonnet in the table, and the tabs mark the cost with ≈
export function priceModelOf(model: string): string {
  const id = model.trim()
  return id.startsWith('claude-') ? id : 'claude-' + id
}

// The key of the table that gives the price, for the dialog: `sonnet-5-5`, or undefined for a model without a price
export function priceSourceOf(priceModel: string): string | undefined {
  const info = priceInfo(priceModel)
  if (info === undefined) return undefined
  return shortModel(info.source === 'fallback' && info.from !== undefined ? info.from : priceModel)
}

export function estimateTokens(text: string): number {
  return Math.ceil(Array.from(text).length / CHARS_PER_TOKEN)
}

// The highest cost at API prices: the input estimate and the full output cap. Null for a model without a price
export function maxCostOf(info: PriceInfo | undefined, inputTokens: number, outputCap: number): number | null {
  if (info === undefined) return null
  return (inputTokens * info.price.input + outputCap * info.price.output) / 1e6
}

function percentOf(part: number, whole: number): string {
  return whole > 0 ? formatPercent(Math.round((part / whole) * 100)) : '0%'
}

// `25 min ago`, `3 h 12 min ago`
export function agoText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return minutes + ' min ago'
  const rest = minutes % 60
  return Math.floor(minutes / 60) + ' h' + (rest === 0 ? '' : ' ' + rest + ' min') + ' ago'
}

function limitLines(d: RecommendInput): string[] {
  const items = limitItems(d.limits, d.limitsAt, d.now)
  if (items.length === 0) return ['No limit reading.']
  // One reading gives all limits, so its age shows once: `(3h ago)` becomes `Last reading: 3h ago.`
  const age = limitsAgeText(d.limitsAt, d.now)
  const lines = items.map((item) => {
    const limit = d.limits.find((l) => l.kind === item.kind)
    const reset = limit?.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
    const parts = [item.text + ' used']
    if (Number.isFinite(reset)) parts.push('resets ' + dayTime(reset))
    if (item.projection !== '') parts.push('100% at the current pace on ' + item.projection.replace(' → 100% ', ''))
    return '- ' + parts.join(', ')
  })
  return age === '' ? lines : [...lines, 'Last reading: ' + age.slice(1, -1) + '.']
}

function costText(model: string, cost: number): string {
  const info = priceInfo(model)
  if (info === undefined) return 'no price'
  return formatMoney(cost) + (info.source === 'fallback' ? ' (price of ' + shortModel(info.from ?? model) + ')' : '')
}

function sessionLines(d: RecommendInput): string[] {
  const rows = rowsOf(d.totals)
  if (rows.length === 0) return ['No model request in this conversation yet.']
  const total = sumAll(d.totals)
  const lines = rows.map((r) => {
    const c = r.counts
    return '- ' + shortModel(r.model) + ' ' + r.scope + ': ' + c.requests + (c.requests === 1 ? ' request' : ' requests') + ', input ' + formatTokens(c.input) + ', cache write ' + formatTokens(c.cacheWrite) + ', cache read ' + formatTokens(c.cacheRead) + ', output ' + formatTokens(c.output) + ', ' + costText(r.model, c.cost) + ' (' + percentOf(c.cost, total.cost) + ')'
  })
  lines.push('Total: ' + formatMoney(total.cost) + '.' + (d.usd === null ? '' : ' /cost reports ' + formatMoney(d.usd) + '. /cost also counts requests that token-watch does not see, for example compaction.'))
  return lines
}

function causeLines(causes: Causes): string[] {
  const whole = causes.start.cost + causes.growth.cost + causes.resume.cost
  const line = (name: string, what: string, c: { tokens: number; cost: number }) => '- ' + name + ' (' + what + '): ' + formatTokens(c.tokens) + ' tokens, ' + formatMoney(c.cost) + ', ' + percentOf(c.cost, whole)
  return [
    line('start', 'the first request of a thread', causes.start),
    line('growth', 'new context in a running thread', causes.growth),
    line('resume', 'after a pause longer than the cache life', causes.resume),
  ]
}

// The strip of the Session tab as letters: W warm, c cold, . no request yet
function stripText(requestTimes: number[], now: number): string {
  return stripCells(requestTimes, now)
    .map((c) => (c.color === '' ? '.' : c.char === '█' ? 'W' : 'c'))
    .join('')
}

function historyLines(d: RecommendInput): string[] {
  const recent = d.requestTimes.filter((t) => t > d.now - STRIP_MS)
  const resumes = d.resumes.filter((r) => r.at > d.now - STRIP_MS)
  return [
    'Main requests in the last 4 hours: ' + recent.length + '.',
    'Cache state for each 5 minutes of the last 4 hours, oldest first (W warm, c cold, . before the first request):',
    stripText(d.requestTimes, d.now),
    resumes.length === 0 ? 'Resumes in the last 4 hours: none.' : 'Resumes in the last 4 hours: ' + resumes.map((r) => agoText(d.now - r.at) + ', cache write ' + formatMoney(r.cost)).join('; ') + '.',
  ]
}

function contextLines(b: Breakdown | null): string[] {
  if (b === null) return ['Not available.']
  const list = (title: string, rows: { name: string; tokens: number }[]) => (rows.length === 0 ? [] : [title + ': ' + rows.map((r) => r.name + ' ' + formatTokens(r.tokens) + ' (' + percentOf(r.tokens, b.total) + ')').join(', ')])
  return [
    'Context: ' + formatTokens(b.total) + (b.max > 0 ? ' of ' + formatTokens(b.max) + ' (' + percentOf(b.total, b.max) + ')' : ''),
    ...b.categories.map((c) => '- ' + c.name + ' ' + formatTokens(c.tokens) + ' (' + percentOf(c.tokens, b.total) + ')'),
    ...list('Largest memory files', b.memoryFiles),
    ...list('MCP servers', b.mcpServers),
    ...list('Custom agents', b.agents),
  ]
}

function weekLines(w: WeekData): string[] {
  const share = (rows: { name: string; cost: number; isUnpriced?: boolean }[]) =>
    rows.length === 0
      ? 'none'
      : rows
          .slice(0, WEEK_ROWS)
          .map((r) => r.name + ' ' + (r.isUnpriced ? 'no price' : formatMoney(r.cost) + ' (' + percentOf(r.cost, w.total) + ')'))
          .join(', ')
  const periods = w.history.filter((h) => !h.isFuture).map((h) => (h.percent === null ? 'no reading' : formatPercent(Math.round(h.percent))))
  return [
    'Week since ' + dayTime(w.start) + ', all sessions on this computer that run token-watch.',
    w.percent === null ? 'Weekly limit: no reading.' : 'Weekly limit: ' + formatPercent(w.percent) + ' used' + (w.resetAt === null ? '' : ', resets ' + dayTime(w.resetAt)) + (w.projection === '' ? '' : ', at the current rate ' + w.projection) + '.',
    ...(periods.length === 0 ? [] : ['Highest weekly percent of each 12 hours, oldest first: ' + periods.join(', ') + '.']),
    'Cost by repo: ' + share(w.byRepo) + '.',
    'Cost by model and scope: ' + share(w.byModelScope) + '.',
  ]
}

// The prices of the newest model of each family in the table, so that the model can put a figure on a change of the model
function priceLines(): string[] {
  const families = [...new Set(Object.keys(PRICES).flatMap((key) => familyOf(key) ?? []))]
  return families.flatMap((family) => {
    const key = newestOf(family)
    if (key === undefined) return []
    const p = PRICES[key]
    return ['- ' + shortModel(key) + ': input ' + p.input + ', cache write ' + p.write1h + ' (1 hour) or ' + p.write5m + ' (5 minutes), cache read ' + p.read + ', output ' + p.output]
  })
}

// The user message of the call: the data that the tabs show, as text. No transcript text, no file content, no prompt text
export function recommendPrompt(d: RecommendInput): string {
  const section = (title: string, lines: string[]) => ['## ' + title, ...lines, '']
  return [
    'token-watch data, read ' + dayTime(d.now) + ' (local time). Costs are estimates at API list prices.',
    '',
    ...section('Plan limits', limitLines(d)),
    ...section('This conversation, by model and scope', sessionLines(d)),
    ...section('Cache writes of this conversation, by cause', [...causeLines(d.causes), 'Cache life: 60 minutes in the main conversation, 5 minutes in a subagent.']),
    ...section('Cache history of this conversation', historyLines(d)),
    ...section('Context of this conversation', contextLines(d.breakdown)),
    ...section('This week', weekLines(d.week)),
    ...section('API list prices in USD per million tokens', priceLines()),
  ]
    .join('\n')
    .trimEnd()
}
