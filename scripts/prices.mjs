#!/usr/bin/env node
// Lists the models that the mod saw and shows how each one is priced: exact, fallback or unpriced.
// It reads the store of the mod, ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/token-watch_*.json,
// and the keys of the price table PRICES in hooks/prices.ts. The rule is in scripts/prices-rule.mjs.
//
// It informs and does not fail: the exit code is 0, also when a model has no price or the store is missing.
// Run it with `make prices`. It is not part of `make verify`.
//
// Usage: node scripts/prices.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectModels, priceKeysOf, reportLines } from './prices-rule.mjs'

const PRICES_FILE = fileURLToPath(new URL('../hooks/prices.ts', import.meta.url))

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
    console.log('No store file token-watch_*.json found in ' + storeDir + '. Run a session with the mod first.')
    return
  }
  const keys = priceKeysOf(readFileSync(PRICES_FILE, 'utf8'))
  if (keys.length === 0) {
    console.error('No price key found in ' + PRICES_FILE + '.')
    process.exitCode = 1
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
  for (const line of reportLines(models, keys, fileCount)) console.log(line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
