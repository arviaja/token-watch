# AGENTS.md

Instructions for people and coding agents that work on this repo.

`token-watch` is a Claude Code mod: a plugin with one hooks module of TypeScript function hooks, which Claude Code loads in its own process. It installs no hooks in `settings.json`. It shows the token use, the plan limits and the cache temperature of the sessions on this Mac. The mod only observes. No hook blocks, changes or delays a request, a tool call or a prompt. The mod calls a model only for `/token-watch recommend`, after the person confirms the cost in a dialog, and it sends only the usage data that the tabs show. It draws a band above the prompt with a button that opens and closes the pane, a pane with five tabs (Now, Session, Week, Why, Help) that the command `/token-watch` also opens and closes, and the dialog of `/token-watch recommend`. `/token-watch band off` and `/token-watch band on` hide and show the band in all sessions, through the store key `settings`. It runs in the Claude Code CLI and in the Code tab of the desktop app.

## This repo is public

Everything in this repo is public: files, commit messages, branch names, tags, issues and pull requests. GitHub keeps each commit that reaches it, and `main` refuses a force-push. A mistake on GitHub cannot be undone with a history rewrite.

- Put no secret, personal data, client name, name of a private repo, issue tracker code, home path or real spend figure in a file, a commit message, a branch name or a screenshot.
- Examples use neutral names: the repo `webshop`, the user `me` (`/Users/me/...`).
- Name a branch `type/topic`, for example `fix/band-width`. Write the issue tracker link in the tracker, not in git.
- `make verify` runs `scripts/check-private.sh`. It fails on a home path of a real user. When the clone has a local list of private terms (`.git/info/private-terms`, never committed), it also fails on each of those terms in a file, in a commit message that is not on `origin/main` yet, or in the branch name.
- Run `make verify` on the branch before the merge, and again on `main` after the merge and before the push. The second run checks the merge commit message.
- When private data reaches GitHub, stop and tell the maintainer at once. Do not try to rewrite the history.

## Architecture

- `.claude-plugin/plugin.json`: the manifest. Its `types` field names the type contract.
- `hooks/hooks.json`: names the one hooks module, `register.ts`.
- `hooks/register.ts`: registers the hooks, the timers and the command. It holds the `$.state` values, writes the snapshots to the shared store, and makes the model call of `/token-watch recommend`. It is the only file that uses `$`. `register(on, options)` reads the `userConfig` option `recommendModel`.
- `hooks/view.ts`: the element trees of the band, the five tabs and the dialog of `/token-watch recommend`. It is pure: the caller passes the element table.
- `hooks/recommend.ts`: pure functions of `/token-watch recommend`: the system prompt, the prompt from the data of the tabs, the input estimate, the highest cost, the price model of an alias and the text of a failed call.
- `hooks/tally.ts`: pure functions for counts, causes of cache writes, snapshots, and the rows of the Now and Week tabs.
- `hooks/temperature.ts`: cache lifetime, stages, heat colours, and the cells and SVG markup of the tube, the bars, the strip and the week history.
- `hooks/format.ts`: text formats (tokens, money, percent), table cells and column fitting.
- `hooks/prices.ts`: the price table, the fallback price of a model without a key (the price of the newest model of its family) and the cost functions.
- `scripts/prices.mjs` and `scripts/prices-rule.mjs`: `make prices`. `prices-rule.mjs` holds the price rule of `hooks/prices.ts` for Node, and it has no import so that the tests can load it. Change both rules together: `tests/prices.test.ts` checks that they agree.
- `types/index.d.ts`: the types of the snapshot and the contract of the `$.state` values.

Tests are in `tests/` and run with `claude plugin test`:

- `format`, `prices`, `recommend`, `tally`, `temperature` and `view` each have one test file for the module of the same name. `view.test.ts` uses a stub element table.
- `hooks.test.ts` and `draw.test.ts` run `register.ts` in the test engine. `hooks.test.ts` covers state, store, timers and hook results. `draw.test.ts` mounts the band and the pane on the terminal and on the desktop.
- `helpers.ts` stubs each mods API call, keeps the store in a Map, tracks the open panes by id and keeps each toast. It stubs `$.model.complete`, so no test makes a real model call. A test sets the result of the stub with the option `modelResult`.

## Commands

- `make verify`: runs `text` (no em or en dash in any text file that git tracks or does not ignore), `secrets` (gitleaks over the history, the staged and unstaged changes and the untracked files), `private` (`scripts/check-private.sh`, see "This repo is public"), `validate` (`claude plugin validate --strict .`) and `test` (`claude plugin test .`). It fails when one of them fails. Run it before each commit.
- `make typecheck`: the TypeScript check. It has known errors and is not in `verify` yet. It needs `tsconfig.json` and `.claude-plugin/types/`. Claude Code generates both when the mod loads, and git ignores both, so a fresh checkout or worktree can fail for that reason.
- `make prices`: runs `node scripts/prices.mjs`. It reads the models in the store of the mod (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/token-watch_*.json`) and prints each one as `exact`, `fallback from <key>`, `unpriced` or `alias, priced as <key>` (the price model of `/token-watch recommend`, which needs no key), then a summary. It informs, always exits 0 and is not in `verify`. Run it when a pane shows `unpriced` or `≈`, then add the new keys to `PRICES` in `hooks/prices.ts`.
- `claude --plugin-dir .`: runs the mod in one session.
- When `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` already loads a clone, `--plugin-dir` loads a second copy. Run a worktree for one session with `claude --settings '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"<path>"}}'`. A shell variable does not work: the settings file replaces it in a live session, although `claude plugin list` shows the shell value.

## Rules of the mods API

`claude plugin validate`, the engine and the tests check these rules.

- Write each mods API call in full, for example `$.store.get(...)`. Never assign `$` or a noun of `$` to a variable.
- Pass `$` only to a function that is declared in `register.ts`, or to `read` and `update`. Never pass it to an imported function.
- The `plugin` and `key` of each state value are string literals. Declare each value in `types/index.d.ts`.
- Keep data in `$.state` and `$.store`. A reload resets the variables of the module.
- A `ui.render` hook reads state and never writes it. Write from a handler or from another event.
- `Svg` exists only in the element tables of the remote surfaces (desktop app, editor, mobile). The terminal table has none. Code that draws one checks `E.Svg`.
- `Svg` is a leaf. It cannot sit inside a `Text`. In a table it sits in its own `Box` with a width and `flexShrink: 0`, and it has no `width` or `height`.
- `Text` takes no `flexShrink` or other flex prop. Put the prop on a `Box` around it.
- The width of a `Box` in a table is a count of cells. A column is a `Box` with a fixed `width` and `flexShrink: 0`, and each row of a table has the same widths.
- The desktop app draws bars as SVG, because its font is proportional. The terminal draws them as text cells. No `Text` holds a bar character on the desktop.
- When the pane is narrower than a table, the table drops columns in a fixed order. The order is in `hooks/view.ts`, in the `*_DROP` lists.
- The pane takes its width from `e.props.bodyColumns`, not from the viewport.
- `$.model.complete` returns the token counts of the call, but not the model that answered. The mod prices an alias as its family (`sonnet` as `claude-sonnet`, see `priceModelOf`).
- The `$.ui.close` of the mod does not run the `ui.close` hook of the mod. A handler that closes a pane does the work of the hook itself (`endRecommend`).
- The test engine cannot raise the `ui.close` of the person (Esc or the close mark). The tests cover the Cancel button, and the open arguments show `closeOnEscape`.
- A `userConfig` field has only `type`, `title`, `description` and `default`. Claude Code accepts `options` (a picker), but the directory does not accept it yet and blocks the version.

## Standards

- Use the ASCII hyphen-minus (`-`) for every dash. Never use an em dash (U+2014) or an en dash (U+2013). `make verify` checks this.
- Write docs and commit messages in Simplified Technical English: short sentences, active voice, one word for one meaning.
- Make one branch for each change. Name it `type/topic`, for example `fix/band-width`. Stage files by path.
- Follow the rules in "This repo is public" above.
- Add or change tests with every change of behaviour. `make verify` must pass.
- Update the design doc when behaviour changes.

## Docs

- Design: [docs/design/2026-10-06-token-watch-design.md](docs/design/2026-10-06-token-watch-design.md)
