# token-watch

`token-watch` is a Claude Code mod. It shows the token use, the plan allowance and the cache temperature of the sessions on this Mac, live. It runs in the Claude Code CLI and in the Code tab of the Claude desktop app.

The mod only observes. It does not change, block or delay a request, a tool call or a prompt. It does not call a model and sends nothing to it. The only trace in the context is the short note that Claude Code records for each `/token-watch`, as for every slash command (see Limits). Its code is one hooks module of function hooks (`hooks/register.ts`) that Claude Code loads in its own process. It installs no hooks in `settings.json`.

## Function

### Band above the prompt

- A cache tube for the main conversation of the session. The tube is full right after a request and empties from the hot end over the 60-minute cache lifetime. Colours run from blue (cold) to red (hot).
- The stage: `LIVE` during a turn, then `HOT`, `WARM`, `COOLING` and `COLD`, with the minutes left.
- The context tokens that the cache holds and the cost to write them to the cache again (`$0.50 to re-warm`). When the cache is cold: the tokens and the cost that the next message writes again. A cost from a fallback price (see Limits) has a `≈`: `≈ $0.50 to re-warm`.
- The weekly and 5-hour percent used of the plan, joined with a dot: `week 49% · 5h 8%`. An old reading shows its age: `(2h ago)`.
- The cache read, cache write and output tokens of this conversation for the model with the highest cost. A dimmed `+1 model` or `+N models` names the other models.

The band stays on one line. It takes the width that Claude Code gives it, keeps 4 cells free, and leaves out parts from the right when it is too wide: first the count of the other models, then the model, then the age of the limits, then the limits. The tube, the stage and its label always stay.

In the terminal, the tube is drawn with block characters. In the desktop app, the tube is an SVG, because the desktop app uses a proportional font. The bars of the pane follow the same rule: block characters in the terminal, SVG in the desktop app.

### Pane

`/token-watch` opens a pane. The keys `1` to `5` select a tab. Esc closes the pane.

| Tab | Content |
|---|---|
| Now | Each session on this Mac that ran the mod in the last 24 hours: cache tube, stage, minutes left, repo, model, context size, weighted cost in the last 60 minutes and today. |
| Session | This conversation by model and scope (main conversation or subagent type; a `≈` after the model name marks a cost from a fallback price): requests, input, cache write, cache read, output, cost and share, a total row labelled `estimate` (the requests that the mod saw, at API prices), a dimmed `reported` row with the cost that Claude Code reports with `/cost`, and a dimmed note that explains the difference. A cause table of the cache writes (start, growth, resume) with a share bar, tokens, cost and share. A cache history of the last 4 hours: a strip with one cell for each 5 minutes, a row `resumes` with a `▲` and the cost at each resume, and a time axis. |
| Week | A meter of the weekly percent, the reset time, a linear projection, and `week used, over time`: the highest weekly percent of each of the 14 periods of 12 hours of the week, a dot or an outline for each period to come, and a day axis under it. Two cost tables, by repo and by model and scope, since the weekly reset, each with a share bar, cost and share. A `≈` after a name in the table by model and scope marks a cost from a fallback price. |
| Why | The context breakdown of this session: a context meter, the categories with a share bar, and lists of the largest memory files, MCP servers and custom agents, each with tokens and share. |
| Help | Static text that explains the band and every term of the other tabs: the tube, the stage words, the parts of the band, the columns and labels of each tab, the `≈` mark and `unpriced`. Each term is drawn as it shows in the band or in its tab, and each has one line of explanation. |

When the pane is narrower than a table, the less important columns are left out in a fixed order.

Every money amount has two decimals and, from `$1,000.00`, a comma as thousands separator: `$0.50`, `$432.64`, `$1,234.56`.

### Data

- Each model request comes from the `turn.step` event, for the main conversation and for each subagent.
- The plan limits come from Claude Code (`session.measure` and `$.session.usage()`). The weekly percent is the figure of Anthropic.
- Each conversation writes one snapshot into the shared mod store (`~/.claude/plugins/store/`), at most every 15 seconds. Snapshots older than 8 days are deleted.
- After `/resume` or `/branch`, the mod sets the cache time from the time since the last response that Claude Code passes, so a cold cache shows at once.

### Hooks

Each hook passes its event on unchanged, with two exceptions that concern only the mod's own items: the hook of `/token-watch` and the hook of the mod's pane answer for themselves. The band hook adds its line above what Claude Code and other mods draw there.

| Event | What the hook does |
|---|---|
| `session.start` | Starts the record of the conversation, reads the plan limits, starts the timers and registers `/token-watch`. |
| `classic.SessionStart` (`clear`, `resume`, `fork`) | Starts a new record for the new conversation. After `/resume` or `/branch`, it sets the cache time from the time since the last response. |
| `session.end` | Writes the last snapshot to the store. |
| `turn.step` | Reads the token use of each model request after the request, from the result. The request and its result stay unchanged. For a subagent request, it reads the subagent type from the agent list of the session (`$.agent.list()`), once for each subagent. |
| `turn.complete` | Clears the working flag of the main conversation. |
| `session.measure` | Saves the plan limits that Claude Code measured. |
| `command.run` (`token-watch` only) | Answers the mod's own command: opens the pane. It adds no text to the transcript. |
| `ui.render` (`AbovePrompt`) | Draws the band. What Claude Code and other mods draw above the prompt stays, below the band. While a survey shows, or while it has no request, no limits and no tokens to show, the hook draws nothing. |
| `ui.render` (`Pane`, the mod's own pane only) | Draws the pane that `/token-watch` opens. |

## Limits

- The mod sees only sessions that run it. Codex and sessions from before the installation are not counted. There is no backfill from transcripts.
- Requests that do not pass through `turn.step`, for example compaction summaries, are not counted. The totals can be lower than `/cost`.
- The split by repo, model and scope is an estimate from tokens weighted with API prices. The price table is in `hooks/prices.ts` (source: the Claude pricing page, read 2026-09-29). A price change needs an edit of that file.
- A model without a key in the table uses the price of the newest model of the same family (the word after `claude-`, for example `opus`). `claude-opus-5-6` uses the price of `claude-opus-5-5` while the table has no key for it. The cost then shows with a `≈` after the model name in the Session table and in the Week table by model and scope, and in the re-warm cost of the band. The Now tab and the totals mix models, so they have no `≈`. A model of a family without any key shows `unpriced`, and its cost is 0.
- How to update the prices: run `make prices`. It lists the models that the mod saw, each as `exact`, `fallback from <key>` or `unpriced`. Read the pricing page, add the new keys to `PRICES` in `hooks/prices.ts`, and run `make prices` again. The costs that the mod already stored keep the price of the day that it counted them.
- The tube assumes a 60-minute cache for the main conversation and 5 minutes for subagents. Claude Code uses the 60-minute cache only on a subscription within its usage limits. Above the limit, or with an API key, the main conversation uses 5 minutes, and the tube shows the cache warmer than it is.
- Each `/token-watch` adds the command to the conversation, as every slash command does: a short note of a few dozen tokens that the model reads with the next message. The band and the pane are drawn only for the user, and the mod sends nothing to the model.
- Mods are new. Anthropic can turn them off remotely, and the mods API can change between releases.

## Requirements

Claude Code 2.1.287 or later. Tested with 2.1.288 (automated tests) and 2.1.291 (manual checks).

## Installation

A mod is not sandboxed. It runs with your permissions in the Claude Code process. Read `hooks/register.ts` before you install it, or run `claude plugin validate` on a clone: it lists each event that the mod hooks and each API call that it makes.

Install the mod from the marketplace of this repo:

    claude plugin marketplace add arviaja/token-watch
    claude plugin install token-watch@token-watch

Sessions that start after the installation load the mod.

To run the mod from a clone, for one session:

    claude --plugin-dir /path/to/token-watch

To run it from a clone for every session in the CLI and the desktop app, add the path to the `env` block of `~/.claude/settings.json`:

    "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/token-watch" }

The setting applies to sessions that start after the change. The loaded mod is the code that is checked out in the clone.

Use one of these ways, not two. Two ways load the mod twice.

## Development

`make verify` runs these checks:

- a check for em dashes and en dashes in text files
- a secret scan (gitleaks)
- `claude plugin validate --strict .`
- `claude plugin test .`

Prerequisites: the `claude` CLI, `gitleaks` and `perl`.

`make typecheck` runs the TypeScript compiler through `npx`, so it also needs Node.js. It reports known errors, so it is not part of `make verify` yet.

`make prices` runs `node scripts/prices.mjs`. It needs Node.js and reads the store of the mod (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/`). It prints each model that the mod saw as `exact`, `fallback from <key>` or `unpriced`, and a summary line. It informs and always exits 0, and it is not part of `make verify`.

Claude Code writes the type declarations of the installed version into `.claude-plugin/types/` and a `tsconfig.json` when the mod loads. Both are not tracked.

## Design

- [Design](docs/design/2026-10-06-token-watch-design.md)
- [Verification](docs/verification.md): manual checks in real sessions, and the automated checks

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) describes. [PRIVACY.md](PRIVACY.md) describes the data that the mod reads, stores and sends.

## License

MIT. See [LICENSE](LICENSE).
