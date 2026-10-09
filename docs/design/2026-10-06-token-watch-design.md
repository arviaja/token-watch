# token-watch mod: design

Date: 2026-10-06.

## Overview

`token-watch` is a Claude Code mod. It shows how the sessions on this Mac use tokens and the plan allowance, live. It shows the cache state of each session as a gradient tube. It runs in the Claude Code CLI and in the Code tab of the Claude desktop app, with the same band and the same pane on both.

The mod only observes. It does not block, change or delay a request, a tool call or a prompt. It calls a model only for `/token-watch recommend`, after the person confirms the cost in a dialog, and it sends only the usage data that the tabs show (see Recommendations). The only trace in the context is the short note that Claude Code records for each `/token-watch`, as for every slash command.

## Context

Cache writes after a pause and large contexts drive most of the cost of a Claude Code session. A request that follows a pause longer than the cache lifetime writes the whole context to the cache again. A request with a large context costs more than a request with a small one.

The goal of this mod is visibility. The mod makes no change itself. `/token-watch recommend` suggests changes, and the person decides.

Mods are available from Claude Code 2.1.287. The mod was built and tested with 2.1.288, and `/token-watch recommend` with 2.1.292. The type declarations that Claude Code writes for the installed version are the authority for event names, method names and props.

## Scope

In scope:

- Token use of each model request: the main conversation and each subagent, per model, per subagent type and per repo.
- The 5-hour and weekly percent used of the plan, and their reset times.
- The cache temperature of the main conversation of each session, as a gradient tube.
- The cause of each cache write.
- The context breakdown of the current session.
- A machine-wide view of all sessions that run the mod.
- The band above the prompt and the pane, in the CLI and in the desktop app.
- One model call for `/token-watch recommend`, after the person confirms its cost.
- A band setting for all sessions on this Mac (`/token-watch band off`, `/token-watch band on`), and a band button that opens and closes the pane.

Out of scope:

- Any change to a request, a tool call, a prompt or a setting of Claude Code. The mod writes only its own band setting, in its own store.
- A warning dialog or a block. The only dialog is the one of `/token-watch recommend`, which the person opens.
- A model call that the person did not confirm.
- Sessions that do not run the mod: Codex, sessions before the installation, sessions with mods turned off.
- A backfill from the transcript files.
- Requests that do not pass through `turn.step` (for example compaction summaries). The totals can be lower than `/cost`.

## Data sources

| Source | Data |
|---|---|
| `turn.step` | One event for each model request. `e.agentId` is set in a subagent and absent in the main conversation. The result holds `usage`: `model`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. `usage` is `null` when no response arrived. |
| `$.agent.list()` (a call, not a hook) | The agents of the session, each with its `id` and `type` (for example `general-purpose`, `Explore`). At the first request of a subagent, the mod finds the `agentId` of the request in the list and keeps a map from `agentId` to subagent type. When the list fails or does not hold the agent, the request counts under the scope `subagent`. The mod does not hook `agent.spawn`. |
| `session.measure` and `$.session.usage()` | `rateLimits`: a list of `{ kind, percentUsed, resetsAt }`, with the kinds `five_hour`, `seven_day` and `spend_limit`. `context`: the tokens of the last main request. `cost.usd`: the session cost as `/cost` computes it. |
| `$.session.usage({ breakdown: 'summary' })` | The `/context` breakdown: categories with tokens, each memory file, each MCP tool with its server, each custom agent. |
| `$.session.id()`, `$.session.cwd()` and related methods | The session identity and the repo. |
| `turn.step` and `turn.complete` | `isWorking` is set by the first main `turn.step` of a turn and cleared by the main `turn.complete`, because `turn.start` does not tell main turns from subagent turns. A main event has no `e.agentId`. |
| `classic.SessionStart` | The sources `clear`, `resume` and `fork` start a new conversation. For `resume` and `fork`, the event holds the time since the last response, the context tokens and, in most builds, the model of the resumed conversation. |
| `$.store` | One JSON store that all sessions on the Mac share. |
| `$.model.complete` (a call) | The one model call of `/token-watch recommend`, through the API client of the session. The result holds the reply and `usage` (the four token counts), but not the model that answered. |

## Cache life

### Rules of Claude Code

Claude Code writes the cache of a request with a life of 5 minutes or 1 hour (source: the prompt caching page of the Claude Code docs, read 2026-10-08):

- The main conversation gets 1 hour on a subscription within the usage of its plan. It gets 5 minutes above the limit (usage credits), with an API key and on a cloud provider.
- Subagents, forks and the other requests outside the main conversation get 5 minutes.
- Overrides, first match wins: `FORCE_PROMPT_CACHING_5M=1`; the variable of the bucket (`CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`); the setting of the bucket (`promptCacheTtl`, `subagentPromptCacheTtl`); `cacheTtl` in the `experimental` frontmatter of a subagent; `ENABLE_PROMPT_CACHING_1H=1`; the default.

A 5-minute cache write costs 1.25 times the input price, a 1-hour cache write 2 times.

### What the mods API gives

- The usage of `turn.step` holds four token counts and the model. It does not split the cache write into 5 minutes and 1 hour.
- `$.session.messages()` holds no usage, in neither form.
- No field of `rateLimits` says that a subscription uses its usage credits.
- `$.session.usage().cost.usd` is the session cost that `/cost` reports. Claude Code books each request in it at the price of its real cache life. Four headless test runs (a main conversation, the same with `FORCE_PROMPT_CACHING_5M=1`, two parallel subagents, and auto mode with Bash and WebFetch) showed this for 20 of 20 requests. The split in the transcripts agreed for each request.

The mod therefore reads the cache life from the session cost. It reads no settings, no environment variables and no transcript.

### Match of a request

- `costSeen` is the last session cost that the mod read. It is a module variable, not a `$.state` value: `bookedSince` reads and writes it with no `await` in between, so two requests that end together never count from one old value. A reload of the module starts it over.
- `turn.step` reads the session cost before `next(e)` and again as the first call after it. Each reading sets `costSeen`. The second reading gives the rise since the last reading of any request: `bookedSince`. A lower reading than `costSeen` starts the count over and gives no rise. `/clear`, `/resume` and `/branch` reset `costSeen`.
- `matchLifetime(usage, booked)` computes the cost of the request at the 5-minute and at the 1-hour price. When exactly one cost is within `1e-9` USD of the rise, that is the life of the request. The tolerance is far below the smallest gap between the two prices (a 1-token write of Haiku 5.5: `7.5e-8` USD) and far above the rounding of a session cost.
- No match: the request wrote no cache, the model has no exact price (a fallback price is no evidence), or no cost fits. No cost fits in fast mode, with US-only inference, with prices of the organization, and when another request booked its cost while this request ran.

### Confirmed life

- `lifetimes` holds the life of each scope: `main`, or the subagent type. `confirmLifetime` keeps `{ known, pending }`. The first match sets `known`. A different match goes to `pending`, and a second match of it in a row confirms it. A match of `known` drops `pending`. A request without a match changes nothing. One rise that fits the other price by chance therefore changes no life.
- The cost of a request uses `known`, or the default of Claude Code before the first match: 1 hour for `main`, 5 minutes for a subagent (`defaultTtl`).
- `classic.PostModelSwitch` names the life of the main conversation (`cache_ttl`). The mod sets `known` of `main` to it.
- A resume (`classic.SessionStart`, source `resume` or `fork`) says whether the cache likely expired. `ttlFromResume` reads the life of the last cache from it: warm after more than 5 minutes proves 1 hour, expired after more than 5 minutes and within 1 hour proves 5 minutes, else the life stays unknown. This proves the life of the last cache, not of the next requests, so it sets `main.ttl` and not `lifetimes`.

## Cache temperature

The cache temperature is the part of the cache life that is left in the main conversation of a session. The mod shows it as a gradient tube.

### Fraction and stage

- `fraction = 1 - (now - lastMainRequestAt) / life`, limited to the range 0 to 1. The life is `main.ttl`: the confirmed life of the last main request, 5 minutes or 1 hour.
- When the life is unknown (`main.ttl` is null), the fraction is null and the band shows no tube, until 1 hour has passed: then the cache is cold for both lives, and the fraction is 0.
- While a turn of the main conversation runs, `fraction` is 1 and the stage is `LIVE`.
- Before the first request of a session, the session has no temperature, and the mod does not draw a tube.
- After /resume or /branch, the mod sets the time of the last main request from the time since the last response that Claude Code passes, so the tube shows the real temperature at once and the first request counts as a resume. When the event has no model, the mod reads the model with `$.session.model()` and uses it when it is a non-empty string. When the call fails or the string is empty, the model stays empty until the first request.

| Stage | Fraction |
|---|---|
| LIVE | a turn runs |
| HOT | from 0.66 |
| WARM | from 0.33 to below 0.66 |
| COOLING | above 0 to below 0.33 |
| COLD | 0 |

### Heat colour

A value `x` from 0 (cold) to 1 (hot) has two colours: `heat(x)` for graphics and `heatText(x)` for text.

`heat(x)` interpolates linearly in RGB between these stops:

| x | Colour |
|---|---|
| 0 | `#378ADD` (blue) |
| 0.33 | `#1D9E75` (teal) |
| 0.66 | `#EF9F27` (amber) |
| 1 | `#E24B4A` (red) |

The `Text` documentation names theme keys and colour names such as `red`. It does not state that hex colours are accepted. A probe in the first build showed that the terminal and the desktop app accept hex colours, so the mod uses them (`COLOR_MODE = 'hex'`). The named mode stays as a fallback: there `heat(x)` gives `blue` below 0.25, `cyan` below 0.5, `yellow` below 0.75 and `red` from 0.75. The named colours follow the theme of the terminal, so `heatText(x)` gives the same named colour in this mode.

#### Why text has its own colour

Claude Code has a dark theme and a light theme, and the mod cannot read which one is active. The mod therefore uses one palette that reads on both backgrounds. A colour that reads on one background can fail on the other: on a white background, the amber part of `heat` (from 0.50 to 0.83) has a contrast below 3:1, and at 0.66 it is 2.17:1.

#### Text colour

`heatText(x)` has the hue of `heat(x)` and a relative luminance (WCAG 2.x) from 0.14 to 0.30. With this range the contrast ratio is at least 3:1 against white (`#ffffff`) and against a dark background (`#1e1e1e`). The luminance 0.30 gives 3:1 against white, and the luminance 0.14 gives 3:1 against `#1e1e1e`.

- `heatText(x)` takes the colour of `heat(x)` and converts its channels to linear RGB.
- When the luminance is above 0.30, it multiplies the three linear channels by one factor that gives the luminance 0.295, and converts them back to sRGB. When the luminance is below 0.14, it does the same for the luminance 0.145. Otherwise it keeps the colour. The 0.005 of margin keeps the rounding to 8 bits inside the range.
- One factor for the three channels keeps the hue: the R, G and B channels stay in the same order.

The blue, teal and red stops are inside the range, so `heatText` keeps them. The amber part is scaled down. This table shows samples (the contrast ratios are against `#ffffff` and `#1e1e1e`):

| x | `heat(x)` | `heatText(x)` | Contrast on white | Contrast on `#1e1e1e` |
|---|---|---|---|---|
| 0 | `#378add` | `#378add` | 3.59 | 4.64 |
| 0.33 | `#1d9e75` | `#1d9e75` | 3.39 | 4.92 |
| 0.5 | `#899f4d` | `#879c4c` | 3.05 | 5.47 |
| 0.66 | `#ef9f27` | `#ca851f` | 3.05 | 5.47 |
| 0.8 | `#ea7c35` | `#e17733` | 3.05 | 5.47 |
| 1 | `#e24b4a` | `#e24b4a` | 3.93 | 4.24 |

Over 101 values of `x`, the least contrast is 3.01 on white and 4.24 on `#1e1e1e`. No stop of `heat` has a luminance below 0.14, so the scaling up has no effect today. It guards a change of the stops.

#### Which function to use

- Use `heatText` for every `Text` that holds a word or a number in a heat colour: the stage words (LIVE, HOT, WARM, COOLING, COLD) of the band and tab 1, the weekly percent of the head grid of tab 3, the percent of the context row of tab 4, the resume mark `▲` of tab 2, and the stage words and the resume mark of tab 5. `heatText(1)` equals `heat(1)`, because red is inside the range.
- Use `heat` for graphics: the cells of the tube and the bars (a block glyph is a drawing, not a word, on the terminal), the cells of the cache history strip and of the week history, and every SVG document of the desktop. A graphic keeps the full scale, because its place and its length carry the value, and the colour only supports them. A word has only its colour to read.

#### Other colours on a light background

| Colour | Where | Result |
|---|---|---|
| `selectionBg` | the background of the selected row | A theme key of Claude Code, so it follows the theme. No change. |
| `dimColor` | labels, headers, empty cells, the axis | Follows the theme. No change. |
| `#8a8a8a`, `stroke-opacity="0.7"` | the outline of a future period in the week history | Over white the stroke is `#adadad` (2.24:1), over `#1e1e1e` it is `#6a6a6a` (3.08:1). It is a thin mark that says "not yet", and it stays visible on both backgrounds. No change. |
| `opacity="0.18"` | the background rect behind each SVG cell | A faint track on both backgrounds: its contrast is 1.1:1 to 1.3:1 on white and 1.2:1 to 1.4:1 on `#1e1e1e`. It is a track by design, and the fill rect carries the value. No change. |

### Tube

The tube has `n` cells: 10 in the band, 8 in tab 1.

- The tube runs from cold at the left to hot at the right. It empties from the hot end.
- Cell `i` (0 to `n - 1`) has the colour `heat((i + 0.5) / n)`.
- `full = floor(fraction * n)` cells are `█`.
- The next cell shows the rest `r = fraction * n - full` as an eighth block: `▏▎▍▌▋▊▉`, index `floor(r * 8) - 1`. When `r * 8` is below 1, the cell is empty.
- An empty cell is `░`, dimmed.
- In the band, `▕` and `▏` (dimmed) frame the tube.

With 10 cells and eighth blocks, the tube has 80 steps over the cache life: one step every 45 seconds for 1 hour, every 3.75 seconds for 5 minutes. The mod redraws every 30 seconds.

### Label

The stage word follows the tube, in bold and in the colour `heatText(fraction)`. A dimmed text follows the stage word:

```text
▕██████████▏ LIVE in turn · 412k cached
▕███████▊░░▏ HOT 47m left · 412k cached · $8.24 to re-warm
▕████▊░░░░░▏ WARM 29m left · 412k cached · $8.24 to re-warm
▕█▊░░░░░░░░▏ COOLING 11m left · 412k cached · $8.24 to re-warm
▕░░░░░░░░░░▏ COLD 15m · next message re-writes 412k ≈ $8.24
cache life unknown · last request 13m ago
```

The examples show the terminal tube with the 10 cells of the band. The desktop draws the tube as the SVG described below.

- `47m left` is the minutes until the cache expires, rounded up.
- For a cold cache, `15m` is the minutes since the cache expired. With an unknown life, the minutes count from the end of 1 hour.
- `cache life unknown · last request 13m ago` takes the place of the tube, the stage and the label while the life is unknown and less than 1 hour has passed.
- `412k cached` is the context tokens of the last main request.
- `$8.24` is the context tokens multiplied by the cache-write price of the session model for the life of the last request, or for the default life of the main conversation while it is unknown.
- When the session model has no exact price, the price of the newest model of its family is used (see Prices), and the re-warm cost reads `≈ $8.24 to re-warm`. The COLD label already reads `≈ $8.24` and stays as it is, for an exact and for a fallback price. A model without any price shows no re-warm cost.

On the terminal, all characters of the tube and the label take one terminal cell, and the tube is built from `Text` elements.

On the desktop surface, the font is proportional, so the characters `█`, the eighth blocks and `░` have different widths. The desktop tube is therefore one `Svg` element instead of the text cells. The view functions get the surface (`e.surface` of the render hook): on `desktop` the tube is the `Svg`, and on every other surface it is the text tube. The `Svg` has these props: `source` (the SVG document), `alt`, `width` and `height` (CSS pixels). For a tube of `n` cells and the fraction `f`, the geometry is:

- The total width is `n * 9`, the height is 14, and the `viewBox` has the same size. The tube has no other shape than its cells: no bulb and no circle.
- Cell `i` is at x `i * 9`, y 1, width 8, height 12, with rounded corners (`rx` 2).
- Each cell has a background rect in the colour `heat((i + 0.5) / n)` with `opacity="0.18"`, and a fill rect in the same colour with full opacity. The width of the fill rect is `8 * clamp(f * n - i, 0, 1)`. It is continuous, with no eighth steps. A fill rect of width 0 is left out.
- The colours are the hex values of `heat`. The frame characters `▕` and `▏` are not drawn.
- `alt` is `cache <percent>% left`, where percent is `Math.max(1, Math.round(f * 100))`, or `cache cold` when `f` is 0.
- The tube in a table cell has no `width` and no `height` prop (the `viewBox` stays in the source). The surface scales it to its box, so it cannot overlap the next column. The band tube has both props.

In the band on the desktop, a `Box` row holds a `Box` with the `Svg` (`flexShrink: 0`), then a `Box` with `flexShrink: 1` that holds one `Text` (`wrap: 'truncate-end'`) with the stage word, the label and the other parts. A `Text` takes no flex props, so the shrinking is on the `Box`. In tab 1, the `Svg` is in the tube box of the cache column.

## Band

The band is a dashboard: it shows only what helps a decision now. The pane is for review. The band supports three decisions: send now or later (the cache), continue, compact or clear (the context), keep the pace or slow down (the limits). It has the same content in the CLI and in the desktop app. The tube is text in the CLI and an SVG in the desktop app.

```text
▕███████▊░░▏ HOT 47m left · 120k cached · $2.40 to re-warm | week 41% · lasts until reset | 5h 12%
▕█▊░░░░░░░░▏ COOLING 8m left · 120k cached | send now: after 14:32 the next message costs $2.40 | week 41%
▕░░░░░░░░░░▏ COLD 15m · next message re-writes 120k ≈ $2.40 | /clear if the topic changed | week 41%
▕███████▊░░▏ HOT 47m left · 120k cached | slow down or use Sonnet | week 76% · runs out Fri 14:00
▕█████████▊▏ HOT 58m left · 120k cached | 5h full at 12:08: pause or use Sonnet | 5h 88% | week 41%
▕███████▊░░▏ HOT 47m left · 640k cached | /compact: each message reads 640k ≈ $0.16 | week 41%
▕█████▊░░░░▏ WARM 3m left · 412k cached | week used up: usage credits until Sun 11:00 | week 100%
▕███████▊░░▏ HOT 4m left · 120k cached · $1.50 to re-warm | today $12.40 · $4.10/h
cache life unknown · last request 3m ago · 120k cached | week 41% · lasts until reset | 5h 12%
```

- The parts are in this order: the cache tube with its stage word and label, the action, then the limits, or the spend with an API key. A dimmed ` | ` separates them.
- The label is the minutes (`47m left`, `15m`, `in turn`), the context (` · 120k cached`, or ` · next message re-writes 120k` when cold) and the re-warm price (` · $2.40 to re-warm`, or ` ≈ $2.40` when cold). `tubeParts` in `format.ts` gives the three parts. Before the mod knows the cache life, the label of an unknown life takes the place of the tube (see Cache life).
- The action is one at a time, the verb in bold, the rest in the text colour (see Actions).
- The limits: `week 41%` with its range, then `5h 12%` and the other limits. The range is `lasts until reset` (dimmed) or `runs out Fri 14:00` (in `heatText(0.9)`), see Range of the week. When the last limit reading is older than 30 minutes, its age follows the last limit, for example `5h 12% (2h ago)`.
- The heat colour shows only on parts that run hot: `runs out Fri 14:00`, the 5-hour percent of the action `5h full`, and a limit at 100% or more (`week 100%`, `5h 100%`). A limit at 100% or more stays in the band whatever the action.
- A session whose first response came back without plan limits (an API key) shows `today $12.40 · $4.10/h` in place of the limits. A subscription has its limits from the first response on, so before that response the band shows no spend: the cost of all sessions on this Mac since local midnight, and the weighted cost of the last 60 minutes, as the Now tab shows them per session (`spendOf` in `tally.ts`). The `· $4.10/h` part is dimmed.
- Every cost is in dollars at API prices. On a subscription the dollars show what the same use costs with an API key. The limits stay in percent, as Claude Code reports them.
- The band shows no model names and no token counts. The Session tab lists them.
- Two buttons sit at the right end: `[ details ]` and `×` (see Band buttons). A `Box` with `flexGrow: 1` between the text and the buttons pushes them there.
- The mod passes the event on when a survey holds the band, when the band is off, and when `×` hid it in this session (see Band setting).
- What other mods draw in the band stays below the line.

### Actions

`actionOf` in `advice.ts` gives the one action of the band, or none. The first that applies wins:

| Order | Action | When |
|---|---|---|
| 1 | `week used up: usage credits until Sun 11:00` | The weekly limit is at 100% or more. Claude Code then bills usage credits and caches the main conversation for 5 minutes. The percent shows as `week 100%` in `heatText(1)`. |
| 2 | `5h full at 15:31: pause or use Sonnet` | The 5-hour window reaches 100% before its reset at the pace so far, and that time is less than 60 minutes away (`fiveHourFullAt`). `5h 88%` comes first among the limits, in `heatText(percent / 100)`. |
| 3 | `slow down or use Sonnet` | The week runs out before its reset at the pace so far (`weekRange`). |
| 4 | `send now: after 14:32 the next message costs $2.40` | The cache life is 1 hour, its last 10 minutes run, and writing the context again costs $1 or more. 14:32 is the end of the cache life, the price is the re-warm price. |
| 5 | `/clear if the topic changed` | The cache is cold, and writing the context again costs $1 or more. |
| 6 | `/compact: each message reads 640k ≈ $0.16` | The context has 400k tokens or more. The price is the context at the cache read price of the model; a model without a price shows no price. |

- The model hint names the next smaller family (`smallerFamily`): Fable, Mythos or Opus `or use Sonnet`, Sonnet `or use Haiku`. Haiku and other models get no hint: `5h full at 15:31: pause`, `slow down`.
- The cache actions (4, 5) need a known cache life, a request, a price for the model and no running turn. A 5-minute cache never gets `send now`: the time is too short to act on. `/compact` needs no running turn. The limit actions (1 to 3) show also during a turn.
- The thresholds are constants in `advice.ts`: `SEND_NOW_MS` (10 minutes), `BIG_REWARM_USD` (1 dollar), `COMPACT_TOKENS` (400,000) and `FIVE_HOUR_SOON_MS` (60 minutes). They are the decisions of 2026-10-09. The re-warm threshold adapts to the model: from about 125k tokens on Opus 5.5 and 50k on Fable 5.1.

### Band setting

- `/token-watch band off` hides the band in all sessions on this Mac. `/token-watch band on` shows it again. `/token-watch band` names the current state. The command ignores case and extra spaces.
- The command writes the setting to the store key `settings` (see Shared store) and answers with a toast (`$.ui.toast`), not with text in the transcript. A toast does not reach the model.
- Each session keeps a copy of the setting in the state value `isBandOn`. It reads the store at the session start and at each 15-second tick, so a change from another session shows within 15 seconds. A changed value invalidates the band.
- A missing key or an unknown value shows the band.
- A failed store write changes nothing: the session keeps its copy, and a toast names the reason.
- `×` hides the band in this session only. It sets the state value `isBandHidden` and shows a toast. It writes nothing to the store, so the other sessions keep their band. `/token-watch band on` clears it. A new session starts with the band shown. `/token-watch band` names the state of this session: off, hidden or on.
- While the band is off or hidden, the band hook passes the event on and draws nothing. All other functions continue: the mod counts each request, writes snapshots, and the pane and `/token-watch recommend` work.

### Band buttons

```text
▕███████▊░░▏ HOT 47m left · 120k cached · $2.40 to re-warm | week 41% · lasts until reset | 5h 12%          [ details ]  ×
```

- The hide button `×` is a `Button` with the key `band-hide`, the label `×`, `role: 'dismiss'`, `plain` and dimmed. Both surfaces draw the label. The desktop app draws no close mark for the dismiss role in the band (checked on 2026-10-08: it drew a longer label as text and wrapped the band). A press runs `×` of Band setting. It has no hotkey, because a `plain` button with a hotkey draws `x: ×`; in the terminal, Tab moves the focus from `[ details ]` to it.
- The pane button is a `Button` with the key `pane`, the label `details`, and `close` while the pane is open. It is not `plain`, so the terminal draws `[ details ]` and the desktop app its native button. It is dimmed at rest.
- A press opens the pane, or closes it while it is up: shown, covered by another pane, or waiting for room. The decision reads `$.ui.panes()`, and the state value `isPaneOpen` when the list fails. It runs the same function as `/token-watch` without an argument. The press is not a slash command, so it adds nothing to the conversation. When the pane does not open, a toast names the reason.
- In the desktop app a click presses it. In the terminal, ctrl+x tab or a click moves the focus to the band. The button has `autoFocus`, so Enter presses it, and the hotkey `t` presses it too. The desktop has no hotkey on the button: it draws a hotkey as a badge that takes width, and a click presses the button there. The hotkey is a letter, because a bare digit in an empty prompt presses a band button: a digit hotkey would take a digit that the person types as an answer.
- The label reads the state value `isPaneOpen`. The pane open and the band button set it. A pane that waits for room counts as open, so the label `close` always closes the pane. The `ui.close` hook of the pane clears it when the person closes the pane with Esc or the close mark. The mod's own `$.ui.close` does not run that hook, so the button press clears it itself. The session start sets it from `$.ui.panes()`, because the pane can stay open over a reload of the module.
- The band keeps 16 cells for the buttons: a gap of 2, the 11 cells of `[ details ]` (the longer label), a gap of 2 and the 1 cell of `×`. The text leaves out its parts in the drop order, and the buttons stay. On the desktop the native `details` button without a hotkey takes about 6.5 cells of the code font and `×` about 1 (measured on a screenshot of 2026-10-08), so the same 16 cells hold them.
- A key chord from the prompt is not possible: the `action` prop of a button takes only an existing keybinding action of Claude Code, and the mod cannot define its own.

### Range of the week

- The weekly limit (`seven_day`) and the 5-hour limit (`five_hour`) each have a window that ends at their reset (`resetsAt`). The weekly window starts 7 days before the reset, the 5-hour window 5 hours before. The spend limit has no window.
- The pace is linear: the percent used, divided by the time from the start of the window up to the reading (`limitsAt`), extended to 100%. `fullAt(percent, start, readAt)` in `format.ts` gives the time of 100%.
- The pace ends at the time of the reading, not at now. A pace up to now would put the 100% time of an old reading too late, because the time since the reading would count as time without use.
- `weekRange(limit, readAt, now)` in `advice.ts` gives `lasts` when the week reaches 100% at or after its reset (or has no pace, at 0%), and `runsOut` with the time when it reaches 100% before. It gives no range without a reset time or a reading, at 100% or more, after the reset, and when the 100% time is not after now (an old reading). For the same reason `week used up` shows only while the reset of the reading is ahead.
- The band shows `lasts until reset` dimmed, and `runs out Fri 14:00` with the day and the time in local time (`dayTime`), in the heat colour.
- `fiveHourFullAt(limit, readAt, now)` gives the 100% time of the 5-hour window for the action `5h full`, when it is before the reset and within the next 60 minutes. The time shows as `clockTime`: `15:31`.

The band must stay on one line. The desktop app wraps a line that is wider than its box, although the `Text` has `wrap: 'truncate-end'`, because its font is proportional. So the band fits itself to the available cells:

- The render hook passes `e.props.bodyColumns` to `bandEls(E, d, surface, available)`.
- `bandCells(text, isTubeShown, isOnDesktop)` gives the width of the band: the tube cells plus the cells of the text. The text holds the stage word, the label, the separators ` | ` and the prefix `ctx `.
- On the terminal, the tube is 12 cells (10 cells and the two frame characters), and each character of the text is one cell.
- On the desktop, `bodyColumns` counts cells of the code font of the app (a monospace font), but the app draws a `Text` in its proportional font, Anthropic Sans. Most characters of that font are narrower than one cell, and some are wider (`W`, `%`). So the band counts each character by its width: `desktopCells` in `format.ts` holds the advance of each printable ASCII character and of `·`, `→`, `≈` and `…`, in hundredths of a code-font cell. A character outside the table counts as 2.2 cells: wider than `W` (1.72), a full-width glyph (1 em) and an emoji of 1.35 em. The band counts the text 4% wider than the table (`DESKTOP_TEXT_FACTOR`). The tube `Svg` is 90 CSS pixels, 11.6 code-font cells, and counts as 12.
- The table comes from the font file of the app (Text Regular, Bold for the capitals of the stage words) at 1.62 code-font cells per em. The 1.62 comes from a screenshot of the desktop app: the Week tab gives the width of a code-font cell (its columns sit at 26 and 63 cells), and the band text beside it gives the em. The table estimates that band text at 49.95 cells, and the screenshot draws it at 49.90. Two later screenshots draw the band text 2 to 3% wider than the table, so the band adds 4%.
- The table belongs to one version of the desktop app. When the app changes its text font, its code font or their sizes, measure again: one screenshot with the band and the Week tab, the cell width from the columns of the Week tab, the em from the band text, and the advances from the font file of the app.
- The budget is `available - 4`. The 4 free cells are a safety margin for the estimate.
- While an action shows, the range `lasts until reset`, the 5-hour value and the other limits besides the week, and the re-warm price leave at any width: the action is the one thing to read. A cold cache keeps its price, because it is the cost of the next message. The limit that the action names stays.
- When the band is wider than the budget, the band leaves out parts until it fits, in this order: the age of the limits, `lasts until reset`, the 5-hour value and the other limits besides the week, the re-warm price, the `$/h` of the spend, the context, the week percent, the spend of today. The order is `BAND_DROP` in `view.ts`. `runs out Fri 14:00` and the limit that the action names never leave.
- The tube, the stage word, the minutes of the label and the action stay always. When they alone are wider than the budget, the terminal cuts the label at the end (`truncate-end`). The desktop app does not cut a `Text`, so there the label wraps to a second line. A band without a tube always keeps its last part, so that the line is never empty.
- Without a number for the available cells (`undefined`), the band leaves out nothing.

## Pane

The command `/token-watch` and the band button open the pane with a requested width of 80 columns and 24 rows. The pane is a sidebar on the right in a wide window and a region above the prompt in a narrow window. The keys `1` to `5` select a tab. Esc closes the pane. While the pane is up, the command and the band button close it, also when another pane covers it or when it waits for room. With the argument `recommend`, the command opens the dialog of Recommendations instead. With `band on`, `band off` or `band`, it sets or names the band setting.

### Table layout

All tables of the pane use the same rules. A grid is a set of rows between the tables of a tab, for example the head of tab 3 and the cache history of tab 2. A grid follows the same rules as a table. The head grid of tab 3 and the context row of tab 4 use the columns of the tables of their tab. The cache history of tab 2 starts with a column of 16 cells. Its label `cache, last 4 h` has 15 characters, and a column keeps one free cell. The strip therefore starts 2 cells to the right of the cause bars.

- Each column has a fixed width in terminal cells.
- A text column is left-aligned. Its text is cut to the column width minus 1, with `…` as the last character of a cut text. There is always at least one space between two columns.
- A number column is right-aligned.
- Every money amount has two decimals, in the band and in every tab: `$0.50`, `$8.24`, `$432.64`. From `$1,000.00` it has a comma as thousands separator: `$1,234.56`. Zero, a negative amount and a value that is not a number show `$0.00`. `formatMoney` in `format.ts` makes the text. A money column is 10 cells wide, so that it holds `$9,999.99` and the one free cell that `cell()` keeps.
- The header row uses the same widths and alignments as the data rows.
- One row builder, `tableEls` in `view.ts`, draws every table and every grid. It takes the columns (width and alignment), the rows and the options below. A cell is a string or a list of elements, for example a bar.
- `format.ts` cuts and pads each string cell to its width with `cell()`, so that the columns align in the terminal. A list of elements is not cut. Its builder gives it the width of its column.
- `cell()` first removes the control characters of the text with `printable()`: the C0 characters (tab and newline included, because a cell is one line), DEL and the C1 characters. A repo folder name, a memory file path, an MCP server name or an agent type can hold one, and the engine refuses a tree whose `Text` holds a control character other than tab and newline. A refused tree loses the whole tab, and a stored repo name stays for 8 days. `repoName()` removes them too, so that a new snapshot and the prompt of `/token-watch recommend` hold the clean name.
- Each column is a `Box` with the same fixed `width` and `flexShrink: 0`. A number column uses `justifyContent: 'flex-end'`, so that the columns also align in the desktop app.
- When the pane is narrower than the table, the table drops columns. The pane gives its width (`e.props.bodyColumns`) to the view functions. `fitColumns(widths, dropOrder, available)` returns the indexes of the columns to keep: it drops the columns in the drop order until the sum of the widths is not more than the available width, or the order is used up. The header row and all data rows draw the same columns. Without an available width, no column is dropped.

Options of `tableEls`, besides `available` and `dropOrder`:

- `headerRows`: the number of header rows at the top. Their string cells are dimmed.
- `boldRows`: the indexes of the rows whose string cells are bold.
- `selectedRows`: the indexes of the rows that are drawn as selected: the row `Box` gets `backgroundColor: 'selectionBg'`, and the string cells are bold.
- `dimRows`: the indexes of the rows whose string cells are dimmed.
- `dimColumns`: the indexes of the columns whose string cells are dimmed, for the label column of a grid. An index is the position in the full list of columns, also when columns drop.

A string cell takes the style of the first rule that applies, in this order: header row, dim row, bold row or selected row, dim column. A list of elements keeps its own style.

Drop orders:

- Tab 1: `ctx`, `model`, `today`, `60 min`. The cache and the repo always stay.
- Tab 2, main table: `input`, `req`, `c.write`, `output`, `share`.
- Tab 2, cause table: the bar column, then `tokens`.
- Tab 2, history grid: the label column.
- Tab 3, head grid: the empty cost column.
- Tab 3, share tables: the bar column.
- Tab 4, context row and category table: the bar column, then the share column.
- Tab 4, lists: no order of their own. A list follows the grid of its tab: its name column is 47 cells wide while the grid keeps the bar column and 26 cells wide when the grid drops it, and its share column stays only while the grid keeps its share column.

Known limit: below 63 cells, the head grid of tab 3 drops only its empty cost column and keeps the bar column, while the share tables drop the bar column. The share column of the head grid and the share columns of the tables then no longer line up.

### Bars

Every bar of the pane uses the style of the tube. A bar has `n` cells and a fill `f` from 0 to 1. It has no frame.

Terminal:

- The cells come from `tubeCells(f, n)`. Cell `i` has the colour `heat((i + 0.5) / n)`. Full cells are `█`, the next cell is an eighth block, and empty cells are `░`, dimmed.
- A bar of 20 cells in a column of 21 cells is followed by one space, so that the text of the column has the width of the column.

Desktop: one `Svg` for each bar, with the geometry of the tube cells:

- Cell `i` is at x `i * 9`, y 1, width 8, height 12, with rounded corners (`rx` 2).
- Each cell has a background rect in its colour with `opacity="0.18"` and a fill rect in the same colour. The width of the fill rect is `8 * clamp(f * n - i, 0, 1)`. A fill rect of width 0 is left out.
- The document is `9 * n` wide and 14 high, and the `viewBox` has the same size.
- The `Svg` has no `width` prop and no `height` prop. It sits in a `Box` with `width` `n` and `flexShrink: 0`. A `Box` width is in cells of the monospace metric of the surface. An `Svg` without `width` takes the width of its markup, up to the width of its box. The markup uses 9 px for each cell, so that every bar scales to its box in the same ratio.
- An `Svg` is a leaf and cannot be a child of a `Text`, so the `Box` is the child of the column box.

Every bar of a share or a percent has 20 cells and sits in a column of 21 cells. These are the bars of the cause table, the share tables, the week meter, the context row and the category table.

Two more drawings use the same cell geometry and the same `Box` rule:

- The cache history strip (`stripSvg`) has one cell for each cell of the strip. A cell with no request before it draws nothing. A warm cell draws its background and a full fill. A cold cell draws only its background rect, in the colour `heat(0)`. The document is 14 high and has no marks. On the terminal, a warm cell is `█` in its colour, a cold cell is `░` dimmed, and a cell with no request before it is a space. The resumes and the time axis are separate rows under the strip (see tab 2).
- The week history (`sparkSvg`) has one cell for each of the 14 periods of 12 hours from the start of the week. Cell `i` is at x `i * 9`. A period with a reading draws a column. The background rect of the column is at y 1, 8 wide and 12 high, with `rx` 2, in the colour `heat(percent / 100)` with `opacity="0.18"`. Its fill rect has the height `12 * max(1/8, clamp(percent / 100))` and ends at the bottom of the background, so that at least one eighth of the height shows. A past period without a reading draws only the background rect, in the colour `heat(0)` with `opacity="0.18"`, like a cold cell of the strip. A future period draws an outline: a rect with `fill="none"` and a 1 px stroke (`stroke="#8a8a8a"`, `stroke-opacity="0.7"`). The rect is the cell inset by half a pixel (x `i * 9 + 0.5`, y 1.5, 7 wide, 11 high, `rx` 1.5), so that the stroke stays inside the cell. The grey shows on a dark and on a light background (see Heat colour), so the `Svg` has no theme colour. The document is `9 * 14` = 126 wide. On the terminal, a column is the character of the history (`▁` to `█`) in the colour `heat(percent / 100)`, a past period without a reading is `░` dimmed, and a future period is `·` dimmed.

The `alt` texts name the content of each drawing. A percent in an `alt` text is a whole number:

| Drawing | `alt` |
|---|---|
| Tube | `cache <percent>% left`, or `cache cold` |
| Share bar | `share <percent>%`, or `unpriced` for a model without a price |
| Week meter | `week <percent>% used` |
| Week history | `week history, highest <percent>%`, or `week history` when no period has a reading |
| Context meter | `context <percent>% used`, or `context size unknown` without a context size |
| Cache history strip | `cache history of the last 4 hours` |

### Tab 1: Now

One row for each session that wrote to the shared store in the last 24 hours. The rows are sorted by weighted cost in the last 60 minutes, highest first.

```text
cache                 repo                 model         ctx    60 min     today
████████ LIVE         webshop              fable-5-1    412k     $6.10    $48.20
████▌░░░ WARM     29m billing-service      opus-5-5     231k     $1.40    $11.70
█▊░░░░░░ COOLING  12m mobile-frontend      opus-5-5     188k     $0.90     $9.80
░░░░░░░░ COLD         data-pipeline-config opus-5-5     380k     $0.00     $9.30
```

The first row is the current session. It has no marker character. The whole row has the background colour `selectionBg`, like a selected row in a list (see the end of this section).

| Column | Width | Alignment | Content |
|---|---|---|---|
| cache | 22 | left | four sub-columns, see below |
| repo | 21 | left | repo name |
| model | 11 | left | model without `claude-` and without a date suffix; empty for a row without a model. It has no `≈` mark: the cost of the row mixes the models of the session (see Prices) |
| ctx | 6 | right | context tokens of the last main request |
| 60 min | 10 | right | weighted cost in the last 60 minutes |
| today | 10 | right | weighted cost since 00:00 local time |

The cache column has four sub-columns. Each is a `Box` with a fixed `width` and `flexShrink: 0`, so that the stage word and the minutes keep their position in the desktop app:

| Sub-column | Width | Content |
|---|---|---|
| tube | 8 | terminal: the 8-cell tube as text; desktop: the `Svg` |
| stage | 8 | the stage word, bold, in the colour `heatText(fraction)` |
| minutes | 5 | the minutes left, for example `48m`, right-aligned with `justifyContent: 'flex-end'` (empty for LIVE and COLD) |
| spacer | 1 | empty |

The text twin of the column (`nowCells`) pads to 22 cells for the width test of the terminal. `nowCells` has the same six columns as the table and no marker column.

The table is 80 cells wide.

- `60 min` is an estimate from the hourly buckets: the current hour, plus the previous hour multiplied by the part of it that is inside the last 60 minutes.
- A session that is in a turn shows `LIVE`.
- A session with no request in the last 24 hours is not shown.
- A snapshot that says `isWorking` but was written more than 10 minutes ago counts as not working.

The current session is the selected row of the table:

- The row `Box` has `backgroundColor: 'selectionBg'`. This is a theme key of Claude Code (dark theme `rgb(38, 79, 120)`, light theme `rgb(180, 213, 255)`), so the colour follows the theme. The `Box` holds the whole row, so the background also covers the tube `Svg` of the desktop and the gaps between the columns. No `Text` has a `backgroundColor`.
- The string cells of the row (repo, model, ctx, `60 min`, today) are bold. The stage word keeps its text colour of heat and its bold. The minutes keep their dimmed style.
- The other rows have no background and no bold. The header row is dimmed.
- `tableEls` takes the option `selectedRows` for this: the indexes of the rows that get the background and bold string cells. Row 0 is the header row. The rule of the style of a string cell treats a selected row like a bold row.
- When no session is current, no row has a background.

### Tab 2: Session

The current session. The tab has three parts with a blank line between them: the table of models and scopes, the cause table and the cache history. Under the table of models and scopes sits a note that explains the two amounts at its end (see below). Before the first model request, the tab shows `No model request in this session yet.`

```text
model      scope             req  input  c.write c.read  output      cost  share
fable-5-1  main               84   1.0k     1.2M  31.0M    120k    $24.10    72%
opus-5-5   general-purpose    52    400     800k  12.0M   14.0k     $9.20    28%
total      estimate          136   1.4k     2.0M  43.0M    134k    $33.30
reported   by /cost                                                $39.20
estimate: the requests this mod saw, at API prices. /cost: the figure of Claude
Code. It also counts requests that the mod does not see, for example compaction.

cache writes                         tokens      cost share
start         █████░░░░░░░░░░░░░░░     300k     $1.00   25%
growth        ██████████░░░░░░░░░░     600k     $2.00   50%
resume        █████░░░░░░░░░░░░░░░     300k     $1.00   25%

cache, last 4 h ████████████░░░░░██████████████░░░░░░░░░░███████
resumes                          ▲ $3.37                 ▲ $0.27
                -4 h        -3 h        -2 h        -1 h     now
```

The examples show the terminal. The desktop draws the bars and the strip as `Svg` (see Bars). It draws the resumes and the time axis as `Box` elements with `Text`.

The main table has one row for each combination of model and scope. The scope is `main` or the subagent type. The model name of a row whose cost comes from a fallback price (see Prices) has ` ≈` after it, for example `opus-5-6 ≈`. A name that is too long for the 11 cells of the column is cut with `…`, and ` ≈` stays whole: `haiku-4… ≈`. The mark is part of the cell text, so the row keeps its widths. The total row and the `reported` row have no mark, because they mix models.

| Column | Width | Alignment |
|---|---|---|
| model | 11 | left |
| scope | 16 | left |
| req | 5 | right |
| input | 7 | right |
| c.write | 9 | right |
| c.read | 7 | right |
| output | 8 | right |
| cost | 10 | right |
| share | 7 | right |

The table is 80 cells wide.

- The total row is bold. Its scope cell says `estimate` and is dimmed. The total is the estimate of the mod: the requests that the mod saw, at API prices.
- The reported row follows the total row and is dimmed. It shows `reported` and `by /cost` in the first two columns and the session cost that Claude Code reports with `/cost` in the cost column, under the cost of the total row. The row is left out when Claude Code reports no cost.
- The note sits under the table and is dimmed. It is one `Text` that wraps to the pane width, not a table row. It shows only when the reported row shows. It says what the two amounts are and why they differ: `/cost` also counts requests that the mod does not see, for example compaction (see Limits). The text is: `estimate: the requests this mod saw, at API prices. /cost: the figure of Claude Code. It also counts requests that the mod does not see, for example compaction.`

The cause table has a header row and one row for each cause of a cache write:

| Column | Width | Alignment | Content |
|---|---|---|---|
| cause | 14 | left | `cache writes` in the header, then `start`, `growth`, `resume` |
| bar | 21 | left, 20 cells | the share of the cause |
| tokens | 8 | right | the cache-write tokens of the cause |
| cost | 10 | right | the weighted cost of the cause |
| share | 6 | right | the share of the cause |

The table is 59 cells wide. The share is the cost of the cause divided by the cost of all three causes, rounded to a whole percent. The bar and the percent show the same part. When the three costs are 0, all shares are 0.

Cause of a cache write, per thread (the main conversation, or one subagent):

- `start`: the first request of the thread.
- `resume`: the time since the previous request of the thread is more than the life of the cache that the previous request left (`threadTtls`).
- `growth`: all other requests.

The cache history is a grid of two columns, 16 and 49 cells wide (65 cells). The label column is 16 cells wide because its longest label, `cache, last 4 h`, has 15 characters and a column keeps one free cell. The second column holds the strip: one cell for each 5 minutes of the last 4 hours, 48 cells, and one free cell. The mod keeps the times of the main requests of the last 4 hours, each with the life that its cost used, in the session state for this strip. Each cell uses the life of the last request before its end. The grid has no header row. The rows are:

| Row | First column | Second column |
|---|---|---|
| strip | `cache, last 4 h` | the 48 cells of the strip |
| resumes | `resumes` | a `▲` at the cell of each resume, with its cost |
| time axis | empty | the labels `-4 h`, `-3 h`, `-2 h`, `-1 h` and `now` |

- The first column is dimmed on every row (`dimColumns: [0]`).
- A warm cell is `█` in the colour `heat(fraction)` at the end of its 5 minutes. A cold cell is `░`, dimmed. A cell before the first request in the strip is empty.
- A resume belongs to the cell whose 5 minutes hold its time. Cell `i` covers the 5 minutes that end at the end of the cell, as in the strip, so a resume at the moment of the render is in cell 47. `stripCellAt` in `temperature.ts` gives the cell, or `null` for a time outside the strip.
- The row of the resumes is drawn only when the session state holds at least one resume inside the strip window (the last 4 hours). The state drops older resumes only at the next request, so the pane ignores them, also in the costs.
- The time axis is drawn under every strip. `-4 h` starts in cell 0, `-3 h` in cell 12, `-2 h` in cell 24, `-1 h` in cell 36, and `now` ends in cell 47, so it starts in cell 45. The labels are dimmed.

The row of the resumes follows these rules. `placeMarks` in `format.ts` applies them.

- The label of a resume is `▲` in the colour `heatText(1)`, one space and the weighted cost of the cache write (`formatMoney`), for example `▲ $3.37`. It starts in the cell of the resume. The cost has no style of its own.
- A label stays whole. It needs its own length and one free cell before the next mark. For the last mark, the free cell is the free cell of the column, so its label must end in cell 47 at the latest. A cost is never cut.
- A mark whose label does not fit shows only `▲`. For two resumes that are close together, the label of the earlier one would reach the mark of the later one, so the earlier one shows only `▲`. The later one keeps its label when it has room.
- The costs of the marks that show only `▲` go in one list in time order, separated by `, `. The list is plain text. It starts 2 cells after the last item of the row (a label or a `▲`).
- When the list does not fit after the last item, it ends 2 cells before the first mark that shows only `▲`, and it keeps 2 cells to the item before that mark. A resume in the last cells of the strip has this layout: `$3.37  ▲`.
- When the list fits in neither place, the function uses the larger place, and `fitList` keeps the newest costs behind the prefix `… `. When no cell is free in either place, the list is left out.
- Two resumes in one cell have one mark. The later resume has the label, and the cost of the earlier resume goes to the list.

The pieces of text of the resumes row and of the time axis sit at cell offsets, so each surface places them in its own way:

- Terminal: each row is a list of `Text` elements. Spaces fill the cells up to the next piece, and the end of the row is padded to 49 cells.
- Desktop: the font is proportional, so spaces in a `Text` do not place text. Each piece sits in a `Box` with `flexShrink: 0` and a `width` that runs from its cell to the cell of the next piece, or to the end of the column for the last piece. A `Box` with only a `width` fills the cells before the first piece. A `Box` width is a count of cells, the same measure that the strip `Svg` scales to, so each piece starts under the cell that it belongs to. The `Text` of a label holds the `▲` and, in a second `Text`, the space and the cost.
- A surface without `Svg` draws the terminal rows.

### Tab 3: Week

The last row of the head grid is `at API prices` with the cost of the week since its reset, when it is above 0: on a subscription the value of the plan, with an API key the spend.

The week starts at the `resetsAt` of the `seven_day` limit minus 7 days. Without a reading, the week starts 7 days before now, and the first row of the head grid shows `week n/a`.

```text
week                      ████████▏░░░░░░░░░░░              41%
resets                    Sun 11:00
at the current rate       100% on Fri 16:00
week used, over time      ░░▁▃▄·········
                          S M T W T F S

by repo                                              cost share
webshop                   ██████████▏░░░░░░░░░    $432.64   51%
billing-service           ██▎░░░░░░░░░░░░░░░░░     $96.31   11%
data-pipeline-config      █▏░░░░░░░░░░░░░░░░░░     $52.87    6%

by model and scope                                   cost share
fable-5-1 main            ███████▊░░░░░░░░░░░░    $331.52   39%
opus-5-5 main             ███████▍░░░░░░░░░░░░    $316.08   37%
fable-5-1 general-purpose ██░░░░░░░░░░░░░░░░░░     $89.77   11%
```

The tab has three parts with a blank line between them: the head grid and the two tables `by repo` and `by model and scope`. All rows of all three parts use the same columns:

| Column | Width | Alignment |
|---|---|---|
| name | 26 | left |
| bar | 21 | left, 20 cells |
| cost | 10 | right |
| share | 6 | right |

The tab is 63 cells wide. In the example, the week starts on Sunday and is in its fifth period, so the nine cells after `▄` in the history row are dots (`·`).

The head grid has the label column dimmed. Its rows are:

| Row | Label | Bar column | Share column |
|---|---|---|---|
| week | `week` | the bar of the weekly percent | the percent, bold, in the colour `heatText(percent / 100)` |
| reset | `resets` | the day and time of the reset | empty |
| projection | `at the current rate` | `100% on Fri 16:00` or `below 100% at reset` | empty |
| history | `week used, over time` | the week history, one cell for each of the 14 periods of 12 hours | empty |
| day axis | empty | the two-letter name of each of the 7 days, dimmed, each over its 2 cells of the history | empty |

- The cost column of the head grid is empty. This column goes first when the pane is narrow.
- Without a weekly percent, the first row shows `week` and `n/a`, both dimmed, and no bar.
- A row with no data is left out: `resets` without a reset time, `at the current rate` without a projection, `week used, over time` and the day axis when no period has a reading.
- The projection is linear: the percent used divided by the hours from the start of the week up to the last measure of the latest weekly reading, extended to 100%. `weekOf` takes the weekly reading with the latest `seenAt` (or `at` without one) from all sessions, and gives that time as `readAt`. The pace ends at the reading and not at now, as in the band (see Projection in the band). `projectionText` returns only the text after the label: `100% on Fri 16:00`, or `below 100% at reset` when the projection is after the reset. When the 100% time is not after now (an old reading), it returns an empty text and the row is left out, as the band leaves out a projection whose time has passed. The label is the first column of the row.
- The history has 14 cells, one for each 12-hour period from the start of the week (7 days). A period uses the highest weekly reading of the period from all sessions. A reading that is not a finite number is ignored.
- A past period without a reading is a dark empty cell. On the terminal, it is `░` dimmed. On the desktop, it is a background rect in `heat(0)` with `opacity="0.18"`. The mod has readings only since it was installed, so the first periods of a week are often empty.
- A future period shows that the period has not come yet. A period is in the future when it starts at or after now. On the terminal, it is `·` dimmed. On the desktop, it is an outline cell (see Bars).
- The label `week used, over time` says what the cells show: the highest weekly percent of each 12-hour period of the week. It is in the dimmed label column.
- The day axis is the row under the history row, and it follows the same rules as the other rows of the grid. Its label cell is empty. The bar column holds the first letter of each day and a space (`S `, `M `, `T `, `W `, `T `, `F `, `S `), dimmed, so the letters stand apart. On the desktop, each letter sits without the space in the middle of a `Box` of 2 cells (`justifyContent: 'center'`), because the letters of a proportional font differ in width. The week starts at the weekly reset that Claude Code reports, not on a calendar day, so a letter covers the 24 hours from the reset time of that day. Each name is over the 2 cells of its day: day `i` is over the history cells `2 * i` and `2 * i + 1`. The name of day `i` is the weekday of `start + i * 24 h` in local time, where `start` is the start of the week that `historyCells` uses. So the axis reads `S M T W T F S` for a week that starts on Sunday and `W T F S S M T` for a week that starts on Wednesday. `weekData` passes `start` to the view in `WeekData.start`, and `weekDayNames(start)` in `format.ts` makes the names.
- On the terminal, the names are 14 characters, followed by the padding of the column. On the desktop, each name is a `Box` with `width` 2 and `flexShrink: 0` that holds one dimmed `Text`. A proportional font does not place padded text under the cells, so the row never pads a `Text` with spaces.
- The history row and the day axis are shown only when at least one period has a reading. A week without a reading has neither.

The share tables have a dimmed header row with the title (`by repo` or `by model and scope`), an empty bar column, `cost` and `share`. Each row is one repo or one model and scope, highest cost first.

- The cost cell has two decimals, for example `$432.64`.
- The share is the cost of the row divided by the total cost of the week, rounded to a whole percent. The bar and the percent show the same part.
- A row of a model without a price shows `unpriced` in the cost cell, an empty share and an empty bar.
- A row of the table `by model and scope` whose cost comes from a fallback price (see Prices) has ` ≈` after its name, for example `opus-5-6 main ≈`. A name that is too long for the 26 cells of the column is cut with `…`, and ` ≈` stays whole: `sonnet-6[1m] general-p… ≈`. The table `by repo` has no mark, because a repo mixes models.
- The weekly percent is the figure of Anthropic and is exact. The split by repo, model and scope is an estimate from the weighted tokens.

### Tab 4: Why

The context breakdown of the current session, read when the tab opens. Until it arrives, the tab shows `Reading the context breakdown…`. The breakdown holds:

- the categories of kind `used`, with tokens and share of the context
- the 10 largest memory files, with path and tokens
- the MCP tools summed per server, with tokens
- the custom agents, with tokens

```text
context of 1.0M           ████████▏░░░░░░░░░░░      412k    41%

category                                          tokens  share
Messages                  ███████████████▍░░░░      318k    77%
System prompt             ▎░░░░░░░░░░░░░░░░░░░      6.0k     1%
System tools              ▊░░░░░░░░░░░░░░░░░░░     17.0k     4%

largest memory files                              tokens  share
webshop/CLAUDE.md                                   9.8k     2%

MCP servers                                       tokens  share
linear                                             11.2k     3%

custom agents                                     tokens  share
reviewer                                             800     0%
```

The tab has a context row, the category table, and one table for each list that has rows. A blank line separates the parts. The context row and the category table use these columns:

| Column | Width | Alignment |
|---|---|---|
| name | 26 | left |
| bar | 21 | left, 20 cells |
| tokens | 9 | right |
| share | 7 | right |

These two parts are 63 cells wide.

- The context row shows `context of <size>` in the name column, dimmed, where the size is the context size of the model (`1.0M` in the example). The bar shows the used tokens divided by the context size. The tokens column shows the used tokens in bold. The share column shows the same part as a percent, in bold and in the colour `heatText(part)`. Without a context size, the label is `context`, the bar is empty and the share is empty.
- The category table has a dimmed header row (`category`, an empty bar column, `tokens`, `share`) and one row for each category of kind `used`, largest first. The bar and the share show the tokens of the category divided by the used context.
- A list (memory files, MCP servers, custom agents) has a dimmed header row with its title (`largest memory files`, `MCP servers`, `custom agents`), `tokens` and `share`. Each row shows the name, the tokens and the share of the used context. A list has no bar. Its name column takes the room of the name column and the bar column of the grid: 47 cells while the grid keeps the bar column, 26 cells when it drops it. The share column stays only while the grid keeps its share column.
- The grid decides the kept columns for all parts of the tab with `fitColumns` and the drop order of tab 4 (see Table layout).

### Tab 5: Help

The tab explains the band and every term of the tabs 1 to 4. Each term shows as it shows in the band or in its tab, and one line explains it. The tab is static text. It has no data of its own: it reads no clock, no store and no state besides the number of the tab. The text is the same in every session.

```text
Band above the prompt
▕████░░░░░░▏          Cache of this conversation. Full after each request,
                      empty when the cache life ends: 1 hour or 5
                      minutes, read from the cost that Claude Code
                      books. Blue is cold, red is hot.
LIVE                  A turn runs.
HOT                   More than 2/3 of the cache life is left.
...
47m left              Minutes until the cache expires.
...
1 Now
highlighted row       This session.
ctx                   Context tokens of the last request.
...
Costs
every cost            An estimate at API list prices. A plan does not bill
                      them. They show where the tokens go.
```

The text lives in `HELP` in `hooks/view.ts`. `tests/help-text.ts` holds a copy of the approved text, and the tests compare the tab with it.

`helpEls(E, available, surface)` builds the tab. It is a pure function and takes no data. `register.ts` draws it when the tab is 5. The tick does not read the list of the store while tab 5 is shown, as for tabs 2 and 4.

Layout:

- The tab has seven sections: `Band above the prompt`, `1 Now`, `2 Session`, `3 Week`, `4 Why`, `Costs` and `/token-watch`. Each section starts with its heading in bold. A blank line separates two sections. The section `Band above the prompt` ends with the buttons `[ details ]` and `×`, drawn as plain text. The section `/token-watch` names the forms of the command: `no argument`, `band off, band on` and `recommend`. A term holds at most 21 cells, so the heading carries the command and the terms carry its forms.
- A row has two columns. The term column is a `Box` with `width: 22` and `flexShrink: 0`. A term is at most 21 cells, so one cell stays free, as in a table. The explanation column is a `Box` with `flexShrink: 1`.
- An explanation is one `Text` with `wrap: 'wrap'`. It is plain: no colour and no dimming. A line of the approved text that continues on the next line is joined into this one string.
- The pane gives its width (`e.props.bodyColumns`) as `available`. The explanation column then gets `width: available - 22`, and at least 12. Without a width, the column only shrinks. A narrow pane wraps the explanation and cuts nothing. The tab drops no column.

A term that is drawn looks like the real thing, on both surfaces. Every other term is plain text.

| Term | Drawing |
|---|---|
| the tube row (no text term) | `tubeEls` with 10 cells at the fraction 0.4. Terminal: the frame and the text cells. Desktop: one `Svg` in a `Box` of 10 cells and `flexShrink: 0`, with no `width` or `height` on the `Svg`. |
| `LIVE`, `HOT`, `WARM`, `COOLING`, `COLD` | Bold, in `heatText` of 1, 0.9, 0.5, 0.2 and 0. Each fraction lies inside its stage. |
| `highlighted row` | Bold, in a `Box` with `backgroundColor: 'selectionBg'`, as the selected row of tab 1. The background covers the text only. |
| `▲ $3.37` | `▲` in `heatText(1)`, then ` $3.37` plain. |

Rule: a term has the spelling of the label that the band or a tab draws.

- The heading of a tab section is the number and the label of the tab bar (`1 Now`).
- A term that names several labels joins them with a comma and a space (`req, input`).
- A number in a term of the band is an example (`47m left`). It has the shape of the real text. A day name in a term is an example too (`runs out Fri 14:00`).
- When a label changes in the band or in a tab, change the term here and the copy in `tests/help-text.ts` in the same change. The test `the terms of the help tab are the labels that the band and the other tabs draw` checks the terms against the trees of the band and of the tabs.

## Recommendations

`/token-watch recommend` sends the data of the tabs to a model in one call and shows the recommendations. The call runs only after the person confirms its cost in a dialog. `hooks/recommend.ts` holds the pure functions, `hooks/view.ts` the dialog (`recommendEls`), and `hooks/register.ts` the command, the call and the counting.

### Command

- `command.run` with the argument `recommend` (after a trim, in any case) opens the dialog. `band on`, `band off` and `band` set or name the band setting. Any other argument opens or closes the pane. The command registers `argumentHint: '[recommend | band on | band off]'`.
- The command reads the data at once: the snapshots of the store, the context breakdown and the state values. It builds the prompt and keeps it in the state value `recommend`. The call sends this prompt, so the dialog shows the estimate of the prompt that it sends.

### Dialog

The dialog is a pane of its own, id `token-watch-recommend`, title `token-watch recommend`, so the tabs keep their state. `$.ui.open` gets `focus`, `closeOnEscape` and `holdToasts` (a dialog), 80 columns and 18 rows.

```text
Ask sonnet for recommendations on this usage?

model          sonnet
input          ≈ 1.3k tokens, estimated from the length of the prompt
output         up to 4.0k tokens
highest cost   ≈ $0.04 at API prices of sonnet-5-5, with the full output cap
plan           On a subscription the call counts against the plan allowance.

The prompt holds the data of the Session, Week and Why tabs: token counts,
costs, plan limits, and the names of repos, memory files, MCP servers and
agents. It holds no transcript text, no file content and no prompt text.

[ Ask sonnet ]  [ Cancel ]
a asks, c or Esc cancels. No call runs before you press Ask.
```

The example shows the terminal. The desktop draws the same tree in its proportional font and its own buttons. The dialog has no `Svg`.

- The title is bold. A row has a label column of 15 cells (`flexShrink: 0`, dimmed) and a value column of `available - 15` cells, at least 20 (`flexShrink: 1`), with one `Text` that wraps (`wrap: 'wrap'`), as the rows of the help tab. Without an available width, the value column only shrinks.
- The highest cost is bold. It has `≈` when the price is a fallback price. A model without a price reads `unknown: the table of the mod has no price for this model`.
- `Ask sonnet` is a `Button` with the key `recommend-ask`, the hotkey `a` and `variant: 'primary'`. `Cancel` has the key `recommend-cancel` and the hotkey `c`. No button has `autoFocus`, so a second Enter after the command does not start the call.
- After Ask, the dialog shows `Asking sonnet…` in bold, the dimmed line `The reply shows here. The call stops after 2 minutes.` and `Cancel`. The mod opens the pane again with the same id, `closeOnEscape`, 80 columns and 24 rows, and without `holdToasts`: the person reads the reply there, and the toasts show again.
- After the reply, the dialog shows one `Markdown` with the reply and a dimmed line with the usage: `sonnet · input 2.4k · output 800 · ≈ $0.01 at API prices · counted in the Session tab under the scope recommend`. The input is the input, cache read and cache write tokens together.
- The reply and the reason pass `drawableText` before they reach the state value. Claude Code 2.1.289 refuses a `Markdown` text of more than 10000 characters and closes the pane, and the mod keeps a `Text` to the same length. In 2.1.293 a `Markdown` has any length, and one drawing holds 100000 characters in all. The mod supports 2.1.287 and later, so the cut stays at 10000. Tab and newline are the only control characters in every version. So `drawableText` removes carriage returns and the other control characters, and cuts a longer text at a whole character with the note `… (cut at 10,000 characters)`.
- A reload of the module (for example after a change of the option in `/config`) drops a call that runs, with the old module. `session.start` runs again after a reload and turns a dialog in the phase `asking` into the message `The call stopped: the mod loaded again while the call ran. Run /token-watch recommend again.`
- After a call without a reply, the dialog shows `No recommendations` in bold, the reason, and the usage line when the call used tokens.
- Esc, the close mark and Cancel close the dialog. A close stops a call that runs (the `AbortController` of the call) and sets the state value to `null`. The `ui.close` hook does this for Esc and the close mark. The `$.ui.close` of the mod does not run the `ui.close` hook of the mod, so the Cancel handler does the same work itself (`endRecommend`). A reply that comes after a close is dropped, and its tokens still count.
- Without a state value (for example after a reload with the pane open), the pane shows `Run /token-watch recommend to ask for recommendations.`

### Estimate and cost

- Input estimate: the characters of the system prompt and the prompt, divided by 3 and rounded up (`estimateTokens`). Data text with many numbers has short tokens. The identity block that Claude Code puts before the system prompt is not counted.
- Output cap: 4,000 tokens (`maxTokens`). Thinking tokens count in the cap.
- Highest cost: the input estimate at the input price plus the output cap at the output price (`maxCostOf`).
- Price model (`priceModelOf`): an id that starts with `claude-` prices itself. An alias becomes `claude-<alias>`, so `sonnet` becomes `claude-sonnet`. It has no version, so `priceInfo` gives the price of the newest model of its family (`claude-sonnet-5-5` on 2026-10-07), and the cost has `≈`. `$.model.complete` resolves the alias like `--model`, but its result does not name the model, so the mod cannot price the resolved model.

### Prompt

The system prompt is fixed text (`RECOMMEND_SYSTEM`):

```text
You give advice on the Claude Code usage of one person. The data comes from token-watch, a Claude Code mod that counts the tokens of the sessions on this computer. The data holds token counts, costs, plan limits and the names of repos, memory files, MCP servers and agents. It holds no conversation text.

Give at most 5 recommendations that lower the cost and the use of the plan allowance. Use only these levers, which the person controls:
- Resume or new session. A message after a pause longer than the cache life writes the whole context to the cache again: a resume. A new session starts with a small context.
- Memory files and MCP servers. Their tokens go into every request.
- Model choice. A smaller model has a lower price for each token.
- Subagents. A subagent works in a context of its own, and its cache expires after 5 minutes.

Rules:
- Base each recommendation on figures in the data, and name them.
- Give the expected saving as a figure when the data allows it.
- When the data shows no problem for a lever, give no recommendation for it.
- Every cost is an estimate at API list prices. On a subscription the plan allowance counts, not the dollars: use the costs to compare.
- Write Markdown: a heading for each recommendation, then at most three sentences. Put the largest saving first. No table. At most 300 words.
```

The prompt (`recommendPrompt`) starts with the time of the reading and has these sections, in this order:

| Section | Content |
|---|---|
| Plan limits | Each limit with its percent, its reset and the time of 100% at the current pace (as in the band). One line `Last reading: 3h ago.` follows when the reading is older than 30 minutes. |
| This conversation, by model and scope | One line for each row of the Session tab: requests, input, cache write, cache read, output, cost and share. A cost from a fallback price names the key of its price. The total, and the cost that `/cost` reports. |
| Cache writes of this conversation, by cause | The three causes with tokens, cost and share, and the cache life of the main conversation (`unknown` before the first match). |
| Cache history of this conversation | The count of the main requests in the last 4 hours, the strip of the Session tab as 48 letters (`W` warm, `c` cold, `.` before the first request), and each resume with its age and cost. |
| Context of this conversation | The context row and the categories of the Why tab, and its lists of memory files, MCP servers and custom agents. |
| This week | The start of the week, the weekly limit with its reset and projection, the highest weekly percent of each past period of 12 hours, and the tables `by repo` and `by model and scope` of the Week tab, at most 10 rows each. |
| API list prices in USD per million tokens | The newest model of each family in the price table, with its input, cache write, cache read and output price. |

The prompt holds no transcript text, no file content and no prompt text. The mod does not read the messages of the session.

### Call

- The press handler of Ask calls `$.model.complete({ model, system, prompt, maxTokens: 4000, effort: 'medium', timeoutMs: 120000 }, { signal })`.
- The model is the `userConfig` option `recommendModel`, a text field in `/config`: an alias (`sonnet`, `opus`, `haiku`) or a full model id. It has no `options`: Claude Code draws a field with `options` as a picker, but the directory does not accept the key yet, and it blocked v0.2.0 for it. The default is `sonnet` (Sonnet 5.5 on 2026-10-07; decision of 2026-10-07). The alias resolves like `--model`, so the default follows each new Sonnet release without an edit. `modelOption` writes an alias and a `claude-` id in lower case, keeps any other id as typed (the id of a provider can depend on case), and gives the default for an empty option or an option that is not a text.
- The effort is `medium`. Thinking tokens count in the output cap, so a high effort could leave no room for the reply.
- The call has a time limit of 2 minutes.
- A request that the engine refuses to send (for example a model that is not allowed) rejects. The dialog then shows `The request was not sent: ` and the reason, and nothing counts.
- A result without a reply has one of three reasons (`failureText`): `The API answered with an error: <kind> (HTTP <status>).`, `The model sent a reply without text.` and `The call stopped before the reply: it was cancelled, or no reply came within 2 minutes.`
- The reply stays in the state value. The mod does not write it into the conversation, so the model of the session does not read it. The slash command note is still recorded, as for every `/token-watch`.

### Counting

- The `usage` of the call goes into `totals` and `hours` under the price model and the scope `recommend`, on every arm of the result. A call whose four counts are 0 adds nothing.
- The cost is `costOf(usage, '5m')`: a cache write has the 5-minute price, as in a subagent, because the call does not use the cache of a conversation.
- The causes and `main` do not change: the call is no thread of the conversation.
- The snapshot carries the hours, so the Week and the Now tab count the call too. The Session tab shows the row `sonnet ≈` `recommend`, and the Week tab the row `sonnet recommend ≈`.

### Model comparison

On 2026-10-07 the command ran with `sonnet` (Sonnet 5.5) and with `opus` (Opus 5.5). All prompts held the same data of the week, from the shared store. The read Sonnet reply came from a desktop session and the Opus reply from a CLI session, so the data of the conversation and of its context differed.

| | Sonnet 5.5 | Opus 5.5 |
|---|---|---|
| Tokens | 2.0k input and 550 output (desktop), 1.9k input and 1.2k output (CLI) | 1.9k input, 1.8k output |
| Cost at API prices | $0.01 and $0.02 | $0.04 |
| Recommendations | 3: general-purpose subagents to Sonnet, simple work of the main conversation to Sonnet, an MCP server off in sessions that do not need it | 4: general-purpose subagents to Sonnet, routine work of the main conversation to Sonnet, Explore subagents to Haiku, Fable only where it is needed |
| Figures | Costs and shares from the data, savings in dollars | Costs and shares from the data, savings in dollars and in points of the weekly limit (1% of the week is about $6.60), and the cut of the pace that the week needs to last until the reset (about 20%) |
| Rules of the answer | Kept: a heading for each recommendation, at most 300 words | Not kept: more than 300 words |
| Errors | The saving of a move to Sonnet is half of the whole cost, but a cache read has the same price on both models | The same error, and Haiku as a quarter of the Opus price, but its cache read is half of the Opus price |

Result: Opus puts the savings in points of the weekly limit, which helps on a subscription. The recommendations are the same in substance, with the same error in the savings, and the Opus call costs about 4.6 times as much. Opus is not clearly better, so `sonnet` stays the default.

## Data model

### Session state (`$.state`)

The state lasts for one conversation. `/clear`, `/resume` and `/branch` reset it.

- `run`: the session id, the start time and the repo of the conversation.
- `totals`: per model, per scope, the counts `input`, `output`, `cacheRead`, `cacheWrite`, `requests`, and the weighted `cost`.
- `causes`: per cause, the cache-write tokens and the weighted cost.
- `main`: `lastRequestAt`, `ttl` (the confirmed cache life of the last main request, or null), `contextTokens`, `model`, `isWorking`, `requests` (the time and the cache life of each main request of the last 4 hours) and `resumes` (the time and the weighted cost of each resume in the last 4 hours). A request that neither reads nor writes the cache changes only `model` and `contextTokens`. State of an older version has `requestTimes` instead of `requests`: `requestsOf` reads those times with 1 hour.
- `contextTokens` is input plus cache read plus cache write plus output of the last main request.
- `limits`: the last `rateLimits` list.
- `limitsAt`: the time of that reading. `session.measure` sets it to the time of the event. The limits are those of the last API response of the session, so `/clear`, `/resume` and `/branch` reload them with the `limitsAt` of the conversation before. Only without an earlier reading do they count as read at the time of the reload.
- `readings`: the limit readings of this conversation.
- `agents`: the map from `agentId` to subagent type.
- `threads`: per thread, the time of the last request that read or wrote the cache.
- `threadTtls`: per thread, the cache life of that request.
- `lifetimes`: per scope, the confirmed cache life and a pending match (see Cache life). `/clear`, `/resume` and `/branch` keep it: the life follows the plan and the settings, not the conversation.
- `hours`: the hourly buckets, keyed by UTC hour, then by `model|scope`.
- `tab`: the selected tab of the pane.
- `breakdown`: the last context breakdown, for tab 4.
- `others`: the snapshots of the shared store that the pane read last.
- `recommend`: the dialog of `/token-watch recommend`: an id, the phase (`confirm`, `asking`, `answered`, `failed`), the model, the price model, the prompt, the input estimate, the output cap, the highest cost, the reply or the reason, and the counted usage. `/clear`, `/resume` and `/branch` do not reset it.
- `isBandOn`: the copy of this session of the band setting in the store. `/clear`, `/resume` and `/branch` do not reset it.
- `isPaneOpen`: the pane of `/token-watch` is open. The band button reads it for its label. `/clear`, `/resume` and `/branch` do not reset it.
- `isBandHidden`: `×` hid the band in this session. `/token-watch band on` clears it. `/clear`, `/resume` and `/branch` do not reset it.

### Shared store (`$.store`)

Each conversation writes one key, `run:<session id>:<start time>`. The band setting is one more key, `settings`, which `/token-watch band on` and `/token-watch band off` write (see Band setting): `{ "band": "off" }`. The command keeps the other values of the key. The key does not start with `run:`, so the clean-up and the list of the other sessions leave it alone. The start time is the epoch milliseconds when the conversation started. `/clear`, `/resume` and `/branch` start a new conversation and a new key. Two conversations therefore never write the same key. The value:

```json
{
  "v": 1,
  "key": "run:<session id>:1791374400000",
  "sessionId": "<session id>",
  "repo": "webshop",
  "model": "claude-fable-5-1",
  "updatedAt": 1791374400000,
  "lastMainRequestAt": 1791374400000,
  "mainTtl": "1h",
  "contextTokens": 412000,
  "isWorking": false,
  "readings": [{ "at": 1791374400000, "kind": "seven_day", "percentUsed": 41, "resetsAt": "2026-10-12T00:00:00Z", "seenAt": 1791378000000 }],
  "hours": { "2026-10-06T14": { "claude-fable-5-1|main": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "requests": 0, "cost": 0 } } }
}
```

- `repo` is the folder name of the session root, without a `.worktrees/<name>` or `.claude/worktrees/<name>` suffix.
- `mainTtl` is `main.ttl`, so the Now tab draws the tube of each session with its own cache life. A snapshot of an older version has no `mainTtl`, and its life counts as unknown.
- `hours` is keyed by the UTC hour of the request. Hours older than 8 days are removed when the session writes.
- The conversation keeps a reading each time a percent changes by a whole point or the reset changes, at most 400 readings. `at` is the time of the first measure of the reading. A later measure that keeps the percent within a whole point sets `seenAt` on the last reading of its kind, and does not change `at` or `percentUsed`. A reading without a later measure has no `seenAt`. The snapshot holds only the `seven_day` readings of the last 8 days.
- A conversation writes its key only after its first request.
- The session writes its key at most once every 15 seconds while it has new data, and once when the session ends.
- 5 seconds after the session start, the mod deletes each `run:` key with an `updatedAt` older than 8 days.
- The pane reads all `run:` keys when it opens, and every 15 seconds while it is shown on tab 1 or tab 3. A session whose band shows the spend (an API key, see Band) reads them every 15 seconds too.

## Prices

The mod contains a price table for the weighting (`PRICES` in `hooks/prices.ts`). The source of the values is the Claude pricing page, read 2026-10-09. The table also holds the Mythos family (Mythos 5.1 and Mythos 5, limited availability) and the older models that the API still serves (Opus 4.7, 4.6 and 4.5, Sonnet 4.6 and 4.5): their prices differ from the newest model of their family, and only an exact price shows the cache life. A price change needs an edit of the table in the mod. The match of the cache life needs the prices to the cent, because Claude Code books the same prices.

- Haiku 5.5 has a higher price for a prompt above 100,000 tokens. Its entry holds `above: { tokens: 100000, rates }`. The prompt is the input, the cache read and the cache write of the request. `ratesOf(price, promptTokens)` gives the rates of a request.
- `costOf(usage, ttl)` and `writeCostOf(usage, ttl)` take the cache life of the request. `rewarmCost(model, contextTokens, ttl)` prices the whole context as one cache write.

### Fallback price

A new model has no key in the table until someone adds it. The mod does not count it with cost 0. It takes the price of the newest model of the same family.

- The id of the model loses a context suffix (`[1m]`) and a date suffix (`-20251001`). A key of the table is an exact price: `claude-opus-5-5[1m]` and `claude-haiku-4-5-20251001` are exact.
- Without an exact price, the family is the word after `claude-`: `opus` for `claude-opus-5-6`. The mod looks for the newest key of that family in the table.
- The newest key has the highest version. The version is the numbers after the family, compared number by number. A missing part counts as 0, so `5` equals `5-0`. `claude-opus-5-5` is newer than `claude-opus-5`, and `claude-opus-5` is newer than `claude-opus-4-8`.
- The newest key sets the price, also for a model with a lower version: `claude-opus-5-6` and `claude-opus-4-9` both use the price of `claude-opus-5-5`. `claude-sonnet-6` uses `claude-sonnet-5-5`.
- A model of a family that has no key (for example `claude-example-1`), and an id that does not start with `claude-`, have no price. The cost is 0, and the pane marks the model `unpriced`.

`priceInfo(model)` returns `{ price, source: 'exact' | 'fallback', from? }`, or `undefined` for a model without a price. `from` is the key that sets a fallback price. `priceOf(model)` returns the price of either source. `costOf`, `writeCostOf` and `rewarmCost` use `priceOf`, so every cost uses the fallback price.

The mod counts the cost when it counts a request, and the snapshots store it. A stored cost keeps the price of the day it was counted. The mark follows the table of today. When someone adds the exact price of a model later, the mark goes away for that model, and the costs that the mod already stored stay as they are.

### Mark of an estimated cost

The mark `≈` shows a cost that comes from a fallback price:

| Place | Mark |
|---|---|
| Session table, model column | ` ≈` after the model name: `opus-5-6 ≈` |
| Week table `by model and scope`, name column | ` ≈` after the name: `opus-5-6 main ≈` |
| Band, re-warm cost of the session model | `≈ $0.50 to re-warm` |

- A name that is too long for its column is cut with `…`, and ` ≈` stays whole.
- `groupWeek` sets `isEstimated` on the `Share` of such a row, next to `isUnpriced`. The Session cells take the flag from `priceInfo`.
- The marked cell has the same width as any other cell of its column, on the terminal and on the desktop.
- The Now tab, the total row of the Session tab, the table `by repo` and the other totals mix models, so they have no mark. The share bars and shares do not change.
- A model with an exact price has no mark. A model without a price shows `unpriced` and no mark.

### Check of the table

`make price-report` runs `scripts/price-report.mjs`. The script reads every `token-watch_*.json` file in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/` and collects the model ids from the `model` fields and from the hour bucket keys (`<model>|<scope>`). It takes the keys of `PRICES` from the copy `PRICE_KEYS` in `scripts/price-rule.mjs`, and it applies the same rule as `prices.ts`. It reads no file in `hooks/`: the plugin directory holds the review of a mod when a script of the plugin points at the files of the mod (see Directory review). It prints one line for each model, sorted: the model, then `exact`, `fallback from <key>`, `unpriced`, or `alias, priced as <key>`. An alias is an id without a version: the price model of `/token-watch recommend` (`claude-sonnet`, see Recommendations). It always takes the price of the newest model of its family and needs no key. The last line is a summary: the count of models and store files, and how many models are exact, fallback and unpriced, and the count of aliases when there is one. It exits with 0, also when a model has no price, and it prints one line when no store file exists. It is not part of `make verify`.

Node does not import TypeScript, so the rule and the keys exist twice: in `hooks/prices.ts` and in `scripts/price-rule.mjs`. Tests in `tests/prices.test.ts` check that both give the same answer for the same table and that `PRICE_KEYS` holds the keys of `PRICES` in the same order.

To update the prices: run `make price-report`, read the pricing page, add the new keys to `PRICES` in `hooks/prices.ts` (with the date of the reading in the comment) and to `PRICE_KEYS` in `scripts/price-rule.mjs`, and run `make price-report` again. The lines with `fallback from` and `unpriced` should be gone. The lines with `alias` stay.

### Directory review

The plugin directory holds the review of a mod ("The directory couldn't confirm that the mod stays the same after it's checked") when the commands, scripts or configuration of the plugin point at the folder of the mod. Its rule: keep the files of the mod and the hooks file in folders that nothing else points at, name each plugin path in full after `CLAUDE_PLUGIN_ROOT` without a wildcard, `..` or other variable, and rename a path that only shares a name with a file or folder of the mod.

- No file outside `hooks/` and `tests/` names a path in `hooks/` or reads a file there. The Makefile and the files in `scripts/` name the price table in words.
- No script shares a name with a file of the mod: the price report is `scripts/price-report.mjs` with its rule in `scripts/price-rule.mjs`, and the target is `make price-report`.
- The tests import from `hooks/`. The directory did not flag them.

## Files

| File | Function |
|---|---|
| `.claude-plugin/plugin.json` | Manifest, name `token-watch`. Names `types/index.d.ts`. |
| `hooks/hooks.json` | Points to `register.ts`. |
| `hooks/register.ts` | The hooks and all mods API calls. |
| `hooks/prices.ts` | The price table, the fallback price of a new model (`priceInfo`) and the cost of a usage record. |
| `hooks/tally.ts` | Pure functions: add a request to the totals, classify the cache-write cause, add to the hourly buckets, merge the store snapshots, sum by repo, by model and scope, and by time window. |
| `hooks/temperature.ts` | Pure functions: fraction, stage, minutes left, `heat(x)` for graphics, `heatText(x)` for text, the cells of the tube with their characters and colours, the cells of the cache history strip and the cell of a time in it (`stripCellAt`), and the SVG documents of the desktop surface: the tube and the bars (`barSvg`), the strip (`stripSvg`) and the week history (`sparkSvg`). |
| `hooks/format.ts` | Pure functions: token and money format, model label, the `≈` mark of a name (`markedCell`), the width of a text in the proportional font of the desktop (`desktopCells`), band text parts, the limits and their projections (`limitItems`, `limitProjection`, `fullAt`), the projection of the Week tab, history cells, the day names of the week, `fitColumns`, `fitList` and `placeMarks`. It has no bar function: `view.ts` draws every bar from the cells and the documents of `temperature.ts`. |
| `hooks/view.ts` | Pure functions that build the element trees of the band and the pane from data: the row builder `tableEls` for all tables and grids, the builders of the bars, the strip, the resumes row, the time axis, the week history and the day axis, `helpEls` with the text of tab 5, and `recommendEls`, the dialog of `/token-watch recommend`. The element table and the surface are parameters. |
| `hooks/recommend.ts` | Pure functions of `/token-watch recommend`: the system prompt, the prompt from the data of the tabs (`recommendPrompt`), the input estimate, the highest cost, the price model of an alias, the model option and the text of a call without a reply. |
| `scripts/price-report.mjs` | `make price-report`: lists the models in the store and how each one is priced. |
| `scripts/price-rule.mjs` | The price rule of `prices.ts` for Node, the copy `PRICE_KEYS` of the keys of `PRICES`, and the pure helpers of `price-report.mjs`. It has no import, so the tests load it. |
| `types/index.d.ts` | Declares the `$.state` values. |
| `tests/*.test.ts` | Unit tests for the pure functions, hook tests and drawing tests. |
| `tests/help-text.ts` | The approved text of tab 5, as a list of sections with terms and explanations. The tests compare the tab with it. |
| `README.md` | Function, data, limits, installation and development. |
| `docs/verification.md` | Results of the manual checks and the automated checks. |

The pure functions do not call the mods API and do not read the clock. The time is a parameter.

## Failure behaviour

- A request without usage adds nothing.
- A failure of `$.store` or `$.session.usage()` is caught. The band and the pane show the last known data.
- If a hook of the mod fails, Claude Code skips the hook. The `turn.step` hook returns the result of `next(e)` in all cases, so the request is never changed.
- A store snapshot with an unknown `v` or a wrong shape is ignored.
- A failed write of the band setting changes nothing and shows the reason in a toast. A pane that does not open after a press of the band button shows the reason in a toast.
- A model call without a reply shows its reason in the dialog, and its tokens count. A request that the engine refuses to send shows the reason and counts nothing.

## Tests

`claude plugin test` runs all tests without a session.

- Pure functions: totals, causes, hourly buckets, pruning, merge of snapshots, temperature stages and cells at fixed times (also a bar whose fill float rounding puts just below a whole number of cells), the SVG documents of the tube, the bars, the strip and the week history, formats (`formatMoney`: two decimals for every amount, a thousands separator from 1,000 dollars, rounding of the cents, and `$0.00` for zero, a negative amount and a value that is not a number), projection (`fullAt`; `limitProjection` for both windows, with the day and the time, the pace up to the reading, no projection at or after the reset, after a time that has passed, at 100%, and without a window, a reset time or a reading time; `limitItems`; the Week tab with the pace up to the reading), history, the day names of the week, `fitList`, `placeMarks` (a label that fits, the free cell before the next mark, a mark without a label and its cost in the list, two resumes in one cell, the list before the mark, the ellipsis) and `stripCellAt`.
- Hooks: two models and two scopes give correct totals; `usage: null` changes nothing; the result of `turn.step` is unchanged; a subagent request is assigned the type from the agent list, which the mod reads once for each subagent; `session.measure` updates the limits; the store write contains the expected snapshot.
- Text colour: for 101 values of `x` from 0 to 1, `heatText(x)` has a luminance from 0.14 to 0.30 and a contrast of at least 3 against `#ffffff` and against `#1e1e1e`, and keeps the order of the R, G and B channels of `heat(x)`. Samples have fixed values, and the named mode returns the named colour.
- Text and graphics on both surfaces: the stage words of the band and tab 1, the percents of tabs 3 and 4 and the resume mark have the colour of `heatText`, and the block glyphs of the tubes, the bars and the histories (terminal) and the SVG documents (desktop) have the colours of `heat`. The test values sit where the two differ.
- Drawings on the `terminal` and the `desktop` surface: the band line, the tube cells and colours, each pane tab, the tab change by key. On the desktop, the band and tab 1 hold one `Svg` with an `alt` that starts with `cache `, and no tube cells; on the terminal they hold no `Svg`.
- History grid on both surfaces: the three rows with their labels and texts; the cell offsets of the marks and of the axis labels (terminal: exact strings; desktop: the `Box` widths before each piece); one resume, two resumes far apart, two resumes close together, a resume in the last cell, many resumes, no resume, and a resume older than 4 hours; the strip `Svg` has no triangle and is 14 high; the label column drops on a narrow pane.
- Desktop width: `desktopCells` for single characters, every printable ASCII character between 0.2 and 2 cells, a character outside the tables as 2.2 cells, and the band text of the calibration screenshot at 49.9 to 50.5 cells; `bandCells` with and without a tube on both surfaces, with the 4% on the desktop.
- Band: each action with its text, its order and its thresholds at their limits (`tests/advice.test.ts`); the band without an action, with each action, with an API key, with an unknown cache life, before the first request and with an old reading; the styles of the action, the range and the heat parts; the parts that an action hides; the drop order at narrow widths, with a range that runs out that stays. For eight states on both surfaces at the widths 60 to 160, the band is never wider than the budget (`available - 4`, and 16 cells less with the buttons), counted with `bandCells`, unless only the parts that never leave are left, and it shows no model name. The draw tests mount the band with a narrow and a wide `bodyColumns`, and with the 5-hour action before and after its time.
- Band projection on both surfaces: both projections after their percents in one plain `Text`; no projection for a limit that does not reach 100% before its reset, without a reset time, and for the spend limit; at the widths 60 to 140 and at each width from 40 to 150, the model leaves, then the 5-hour projection, then the weekly projection, then the limits, and the band is never wider than the budget; an old reading keeps the times of its pace and shows its age, the age leaves before the projections, and a 5-hour time that has passed is hidden. The draw tests mount the band with both projections at 170, 135, 120 and 100 cells on the terminal, at 160, 115, 100 and 90 cells on the desktop, and after the 5-hour time has passed.
- Reading time: a measure within a whole point moves `seenAt` of the last reading of its kind and never back, `weekOf` takes the reading with the last measure, `mergeReadings` drops a `seenAt` that is not a number, the snapshot carries `seenAt`, the Week tab paces up to `seenAt` and leaves out a time that has passed, and a `/clear` after two hours keeps the reading time, so the band shows `(2h ago)` and the pace up to that reading on both surfaces.
- `fitColumns`: the table fits, one drop, several drops, no available width. A narrow tab 1 keeps the cache, the repo, `60 min` and `today`.
- Table layout: every row of each table has the same width, and each column starts at the same position in every row.
- Session labels on both surfaces: the total row has a dimmed `estimate` cell and a bold rest; the `reported` row and the note show only when Claude Code reports a cost; the note is one dimmed `Text` that is not a table row, and the tables stay aligned at every width.
- Money columns: every money column of the four tabs holds `$9,999.99` without a cut, and a Week share row shows its cents.
- Prices: the version comparison (number by number, a missing part as 0, `10` above `9`); the newest key of each family; an exact price for a date and a `[1m]` variant; the fallback price of `claude-opus-5-6` and `claude-opus-4-9` (both from `claude-opus-5-5`) and `claude-sonnet-6`; exact prices for the older models that the API still serves, and the cache life that they show; no price for `claude-example-1`; the cost functions with the fallback price; a hook test that stores the fallback cost of a request.
- Mark `≈` on both surfaces: the Session table and the Week table `by model and scope` show ` ≈` after the name of a fallback row, also when the name is cut, with the widths unchanged; no mark for an exact price, in the Now tab, the total row and the table `by repo`; the band reads `≈ $3.29 to re-warm` for a fallback price and has no second `≈` in the COLD label.
- Cache life: `matchLifetime` for a 1-hour and a 5-minute booking, and no match for a rise with another booking in it, twice the price, no reading, no cache write, a fallback price and no price; `confirmLifetime` (first match, a pending match, two in a row, a request without a match); `ttlFromResume` at the limits of 5 minutes and 1 hour; `fraction`, `minutesLeft` and `minutesCold` with 5 minutes and with an unknown life; the strip with the life of each request; `requestsOf` for state of an older version; the snapshot with and without `mainTtl`. The hook and draw tests use a stub of the session cost that books each request at a chosen life, or at a price that fits none (`tests/helpers.ts`, option `booking`, and `ledger.during` for a cost that another request books while a request runs). They check the 5-minute countdown and re-warm cost, `cache life unknown`, the two matches in a row, a cost booked inside and before the window, a session cost that falls, the three outcomes of a resume, the life at a model switch, a request without cache, the costs of a subagent at 1 hour, and the cause of a cache write against the life of the previous request. Haiku 5.5 below and above 100,000 prompt tokens, and the read price of Sonnet 5.5.
- `scripts/price-rule.mjs`: the same answer as `priceInfo` for the same table, `PRICE_KEYS` equal to the keys of `PRICES` in order, the model ids read from a store value, and the report lines.
- Week history and day axis on both surfaces: the label `week used, over time`; a future period is a dimmed `·` on the terminal and an outline rect without a fill rect in the `Svg`; the axis row has the exact names on the terminal and 7 `Box` elements of `width` 2 on the desktop; the axis starts at the weekday of the start of the week, tested for a week that starts on Sunday and one that starts on Wednesday; a week without a reading has no axis row; the head grid keeps its widths at 80, 62 and 45 columns.
- Selected row of tab 1 on both surfaces: the current row has `backgroundColor: 'selectionBg'` on its row `Box` and bold string cells, the other rows and the header have no background, no `Text` has a `backgroundColor`, no `Text` holds `>`, and the row keeps its background when columns drop. The draw tests mount the pane on both surfaces with a second session in the store, so that the engine checks the prop.
- Table options and drop orders: `dimRows`, `dimColumns`, `selectedRows` and their precedence; the kept columns of every table and grid of tabs 2 to 4 at the full width and at narrow widths; the lists of tab 4 follow the grid.
- Alignment of the four tabs on both surfaces: every row of a table or grid has the same list of column widths, every column box has `flexShrink: 0`, and on the terminal the text of a row has the length of the sum of its widths. On the desktop, no `Text` holds a bar character (`█`, `░`, an eighth block or a sparkline character), and every `Svg` sits in a `Box` with a `width` and has no `width` prop. The checks run at the full width and at a narrow width.
- Mount tests of tabs 2 to 5 on the `terminal` and the `desktop` surface: the pane is mounted, and the keys `tab-2` to `tab-5` select the tabs. Each tab draws the tree of the mod: the tab buttons are present, and the text `drawn by Claude Code` of the engine is not. The column boxes have the widths of the tab. On the desktop, each tab holds at least one `Svg` and no `Text` with a bar character. On the terminal, each tab holds no `Svg` and a `Text` with `█` or `░`.
- Help tab on both surfaces: the tab bar has the five labels `Now`, `Session`, `Week`, `Why` and `Help`, and the key `tab-5` selects the tab. Every term and every explanation of the approved text is in the tree, and the six headings are bold. The term column is a `Box` of `width: 22` and `flexShrink: 0`. The stage words, the selected row, the resume mark and the tube have the styles of the table above, and every other term is plain. The explanation is one plain `Text` with `wrap: 'wrap'`, also at 45 columns, where nothing is cut. The terms match the labels of the band and of tabs 1 to 4. The tab needs no request, reads no key of the store, and does not change when data arrives.

- Band setting: `band off` and `band on` write `settings` to the store, keep its other values and answer with a toast and no text; `band` names the state; case and extra spaces do not matter; a failed write changes nothing and says why; the clean-up keeps the key; with the band off a request still counts. On both surfaces the band hides at once in the session of the command and at the next tick in another session, and shows again; a session that starts with the band off draws no band and no button, and the command still opens the pane.
- Pane button on both surfaces: the band draws a `Button` keyed `pane` with the label `details`, `autoFocus` and `dimColor`, and not `plain`, with the hotkey `t` on the terminal and none on the desktop; a press opens the pane with `focus` and `closeOnEscape`, the label turns to `close`, a second press closes the pane and the label turns back; a press shows no toast. A press with a refused open names the reason in a toast. The command closes a shown pane and opens it again after that. A press closes a pane that another pane covers, and a pane that waits for room reads `close`, names the reason in a toast and closes at the next press. `tests/helpers.ts` tracks the open panes by id and whether each one is placed, stands for a covered pane with the option `paneShown: false`, and keeps each toast. The test engine raises no `ui.close` of the person, so the label after Esc is a manual check.
- Hide button on both surfaces: the band draws a `Button` keyed `band-hide` with `role: 'dismiss'`, `plain`, `dimColor` and the label `×`; a press hides the band in this session with a toast and writes no store key; the hide stays over a tick; `/token-watch band` names it; `/token-watch band on` shows the band again. A `Box` with `flexGrow: 1` stands before the two buttons, in the order `pane`, `band-hide`.
- Recommend, pure functions: the price model of an alias and of an id, the price source, the model option with its default, the input estimate, the highest cost with and without a price, the text of each reason of a call without a reply, the time ago, the levers and rules of the system prompt, the sections and lines of the prompt with data and without data, and the price that a fallback cost names.
- Recommend dialog on both surfaces: `/token-watch recommend` opens the pane `token-watch-recommend` as a dialog (`focus`, `closeOnEscape`, `holdToasts`, 80 columns, 18 rows) with the title, the five rows, the estimate, the output cap, the cost at the price of `sonnet-5-5`, the note on the plan, the data note and the two buttons, and no model call runs. The rows keep the label column of 15 cells and wrap the value at 80 and at 45 columns. Ask runs one call with the model, the system prompt, the cap, the effort and the time limit, and the dialog showed the estimate of that prompt. The pane opens again for the reply without `holdToasts` and with 24 rows. The reply is one `Markdown`, with the usage line. Cancel closes the dialog and runs no call. A call without a reply shows the reason, and a refused request shows why. The option `recommendModel` sets the model of the dialog and of the call, and a typed full model id goes to the call as typed, with its exact price. The phases and a model without a price, in `view.test.ts`.
- Recommend counting: the call goes into the hours of the snapshot under `claude-sonnet|recommend` with the cost of `costOf(usage, true)`; the Session tab shows the row on both surfaces; a call without a reply counts its tokens; a call with no tokens adds no row; Cancel while the call runs drops the reply and counts the tokens. `tests/helpers.ts` stubs `$.model.complete`: no test makes a real model call. The test engine raises no `ui.close` of the person, so Esc is covered by `closeOnEscape` in the open arguments.
- Recommend limits: `drawableText` removes control characters and cuts a text at 10000 characters with a note, also for a character outside the basic plane; a reply of 15000 characters with a carriage return is drawn on both surfaces; two quick presses of Ask run one call; a second `session.start` (a reload) turns the phase `asking` into the message of the reload; `make price-report` prints `claude-sonnet` as `alias, priced as claude-sonnet-5-5` and counts it as an alias.

`claude plugin validate --strict` passes.

## Manual verification

- CLI: start `claude --plugin-dir /path/to/token-watch`. Check the band, the cache tube over its cache life without input (1 hour on a subscription, 5 minutes with `FORCE_PROMPT_CACHING_5M=1`), the pane with its five tabs, and a second session in tab 1. Read tab 5 against the band and the tabs.
- Desktop app: the same checks in a Code tab session.
- Compare the session totals with the session transcript.
- `/token-watch recommend` in the CLI and in the desktop app: the dialog shows the cost, Cancel and Esc close it without a call, Ask shows the reply, and the Session tab shows the row `sonnet ≈` `recommend`.
- Band buttons in the CLI and in the desktop app: the buttons sit at the right end, a click on `[ details ]` opens and closes the pane, the label follows, Esc on the pane turns the label back to `details`, and the native buttons of the desktop app fit beside the band text. `×` hides the band in this session and not in a second session, and `/token-watch band on` shows it again. In the CLI, ctrl+x tab and then Enter or `t` press `[ details ]`, and Tab moves to `×`.
- Band setting: `/token-watch band off` in one session hides the band there at once and in a second session within 15 seconds; `/token-watch band on` shows both again; the setting stays after a new session starts.
- `claude --settings '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":""}}'` starts a CLI session without the mod of a clone (checked on 2026-10-08: no band). A shell variable does not: `CLAUDE_CODE_PLUGIN_DIRS=<path> claude` loaded the clone of `settings.json`, although `claude plugin list` showed the path of the variable.
- To check a branch in a live CLI session while `settings.json` loads the clone: `claude --settings '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"/path/to/worktree"}}'`. In `claude -p` this did not replace the clone (checked on 2026-10-09: the snapshot came from the clone); `claude -p --plugin-dir /path/to/worktree` ran the branch.
- Cache life against Claude Code (checked on 2026-10-09 with 2.1.294, `claude -p --model haiku --plugin-dir <worktree>`): a main conversation on a subscription, the same with `FORCE_PROMPT_CACHING_5M=1`, two parallel `Explore` subagents, and a session with 8 requests above 100,000 prompt tokens. In each run the cost total of the snapshot equals `total_cost_usd` of the run, so each request matched. `mainTtl` was `1h`, `5m`, `1h` and `1h`, and the split of each request in the transcript agreed, with 5 minutes for the subagents. Headless `/usage` shows no `Prompt cache (main)` line; that line needs an interactive session.

## Installation

- Development: `claude --plugin-dir /path/to/token-watch`. The CLI reloads the mod on each save.
- Permanent use in the CLI and the desktop app: an entry for the repo path in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`.
- Turn off, turn on and uninstall: see the README. `claude plugin uninstall` and `claude plugin marketplace remove` keep the store file of the mod (`~/.claude/plugins/store/token-watch_<marketplace>-<hash>.json`, where the hash is the first 12 hex digits of the SHA-256 of `token-watch@<marketplace>`).
