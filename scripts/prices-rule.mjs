// The rule that prices a model, and the pure helpers of scripts/prices.mjs. It has no import, so the tests in tests/ can load it.
//
// The rule is the one of hooks/prices.ts, written again here because Node does not import TypeScript:
// - The id loses a context suffix ([1m]) and a date suffix (-20251001).
// - A key of the table is an exact price.
// - Else the price of the newest model of the same family is the fallback price. The family is the word after `claude-`.
//   The newest model has the highest version, compared number by number. A missing part counts as 0.
// - A model of a family without a key has no price.
// tests/prices.test.ts checks that this file and hooks/prices.ts give the same answer.

function isObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// The keys of the table PRICES, from the text of hooks/prices.ts: the quoted `claude-...` keys
export function priceKeysOf(text) {
  const start = text.indexOf('export const PRICES')
  const end = start === -1 ? -1 : text.indexOf('\n}', start)
  const block = start === -1 ? text : text.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(/^\s*['"](claude-[^'"]+)['"]\s*:/gm)].map((match) => match[1])
}

export function baseModel(model) {
  return model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
}

export function familyOf(model) {
  return /^claude-([^-]+)/.exec(model)?.[1]
}

export function versionOf(model) {
  return model
    .replace(/^claude-[^-]+-?/, '')
    .split('-')
    .filter((part) => part !== '')
    .map((part) => parseInt(part, 10) || 0)
}

export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// { source: 'exact' }, { source: 'fallback', from: <key> } or { source: 'unpriced' }
export function statusOf(model, keys) {
  const base = baseModel(model)
  if (keys.includes(base)) return { source: 'exact' }
  const family = familyOf(base)
  let from
  for (const key of keys) {
    if (family === undefined || familyOf(key) !== family) continue
    if (from === undefined || compareVersions(versionOf(key), versionOf(from)) > 0) from = key
  }
  return from === undefined ? { source: 'unpriced' } : { source: 'fallback', from }
}

// Adds the model ids of a stored value to the set: the `model` fields and the model part of the hour bucket keys `<model>|<scope>`
export function collectModels(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectModels(item, found)
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'model' && typeof item === 'string' && item !== '') found.add(item)
      if (key === 'hours' && isObject(item)) {
        for (const hour of Object.values(item)) {
          if (!isObject(hour)) continue
          for (const bucket of Object.keys(hour)) {
            const model = bucket.split('|')[0]
            if (model !== '') found.add(model)
          }
        }
      }
      collectModels(item, found)
    }
  }
  return found
}

// An id without a version is an alias of /token-watch recommend (`claude-sonnet`): it always takes the price of the newest model of its family, so it needs no key
function isAlias(model, status) {
  return status.source === 'fallback' && versionOf(baseModel(model)).length === 0
}

function describe(model, status) {
  if (isAlias(model, status)) return 'alias, priced as ' + status.from
  return status.source === 'fallback' ? 'fallback from ' + status.from : status.source
}

// One line for each model, sorted, and a summary line
export function reportLines(models, keys, fileCount) {
  const sorted = [...models].sort()
  const width = Math.max(0, ...sorted.map((model) => model.length))
  const counts = { exact: 0, fallback: 0, unpriced: 0, alias: 0 }
  const lines = sorted.map((model) => {
    const status = statusOf(model, keys)
    counts[isAlias(model, status) ? 'alias' : status.source]++
    return model.padEnd(width) + '  ' + describe(model, status)
  })
  const noun = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')
  lines.push(noun(sorted.length, 'model') + ' in ' + noun(fileCount, 'store file') + ': ' + counts.exact + ' exact, ' + counts.fallback + ' fallback, ' + counts.unpriced + ' unpriced' + (counts.alias > 0 ? ', ' + counts.alias + (counts.alias === 1 ? ' alias' : ' aliases') : ''))
  return lines
}
