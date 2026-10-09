#!/usr/bin/env node
// Lists the models that the mod saw and shows how each one is priced: exact, fallback or unpriced.
// It reads the store files of the mod in the folder plugins/store of the Claude Code config folder.
// The keys of the price table and the rule are in scripts/price-rule.mjs.
//
// It informs and does not fail: the exit code is 0, also when a model has no price or the store is missing.
// Run it with `make price-report`. It is not part of `make verify`.
//
// Usage: node scripts/price-report.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRICE_KEYS, collectModels, reportLines } from './price-rule.mjs'

function main() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), '.claude')
  const storeDir = join(configDir, 'plugins', 'store')
  let names = []
  try {
    names = readdirSync(storeDir).filter((name) => /^token-watch_.*\.json$/.test(name))
  } catch {
    // A missing store folder means that no file exists
  }
  if (names.length === 0) {
    console.log('No store file of the mod found in ' + storeDir + '. Run a session with the mod first.')
    return
  }
  const models = new Set()
  let fileCount = 0
  for (const name of names.sort()) {
    try {
      collectModels(JSON.parse(readFileSync(join(storeDir, name), 'utf8')), models)
      fileCount++
    } catch (error) {
      console.error('Skipped ' + join(storeDir, name) + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  for (const line of reportLines(models, PRICE_KEYS, fileCount)) console.log(line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
