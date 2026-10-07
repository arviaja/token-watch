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

Out of scope:

- Any change to a request, a tool call, a prompt or a setting.
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

A check of one week of transcripts showed the cache lifetimes. 98.5% of the cache writes of main conversations use the 1-hour lifetime. 100% of the cache writes of subagents use the 5-minute lifetime. The usage that `turn.step` reports does not separate the two. The mod therefore uses these fixed values:

- The cache lifetime of a main conversation is 60 minutes.
- The cache lifetime of a subagent is 5 minutes.
- A cache write in a main conversation is priced at the 1-hour write price. A cache write in a subagent is priced at the 5-minute write price.

## Cache temperature

The cache temperature is the part of the cache lifetime that is left in the main conversation of a session. The mod shows it as a gradient tube.

### Fraction and stage

- `fraction = 1 - (now - lastMainRequestAt) / 60 minutes`, limited to the range 0 to 1.
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

With 10 cells and eighth blocks, the tube has 80 steps over 60 minutes, one step every 45 seconds. The mod redraws every 30 seconds.

### Label

The stage word follows the tube, in bold and in the colour `heatText(fraction)`. A dimmed text follows the stage word:

```text
▕██████████▏ LIVE in turn · 412k cached
▕███████▊░░▏ HOT 47m left · 412k cached · $8.24 to re-warm
▕████▊░░░░░▏ WARM 29m left · 412k cached · $8.24 to re-warm
▕█▊░░░░░░░░▏ COOLING 11m left · 412k cached · $8.24 to re-warm
▕░░░░░░░░░░▏ COLD 15m · next message re-writes 412k ≈ $8.24
```

The examples show the terminal tube with the 10 cells of the band. The desktop draws the tube as the SVG described below.

- `47m left` is the minutes until the cache expires, rounded up.
- For a cold cache, `15m` is the minutes since the cache expired.
- `412k cached` is the context tokens of the last main request.
- `$8.24` is the context tokens multiplied by the 1-hour cache-write price of the session model.
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

The band is one line above the prompt. It has the same content in the CLI and in the desktop app. The tube is text in the CLI and an SVG in the desktop app:

```text
▕███████▊░░▏ HOT 47m left · 412k cached · $8.24 to re-warm | week 41% · 5h 12% | fable-5-1 r31M w1.2M o120k +1 model
```

- The parts are in this order: cache tube with its label, plan limits, context size, then the token totals of this session for one model (`r` cache read, `w` cache write, `o` output).
- The band leaves out the context size (`ctx 412k`) while the tube is shown, because the tube label already gives it. Without a tube, the band shows `ctx` when the context size is known.
- The band shows only the model with the highest weighted cost of this conversation. When the conversation used more models, a dimmed ` +1 model` or ` +N models` follows, where N is the number of the other models (`+1 model`, `+2 models`).
- The limits are joined with ` · `, for example `week 41% · 5h 12%`.
- When the last limit reading is older than 30 minutes, its age follows the limits, for example `week 41% (2h ago)`.
- When a limit reaches 100% before its reset, its projection follows its percent (see Projection in the band).
- The mod passes the event on when a survey holds the band.
- What other mods draw in the band stays below the line.

### Projection in the band

```text
▕███████▊░░▏ HOT 47m left · 412k cached · $8.24 to re-warm | week 49% → 100% Sat 21:06 · 5h 62% → 100% Wed 15:31
```

- The weekly limit (`seven_day`) and the 5-hour limit (`five_hour`) each have a window that ends at their reset (`resetsAt`). The weekly window starts 7 days before the reset, the 5-hour window 5 hours before. The spend limit has no window and no projection.
- The projection is linear: the percent used, divided by the time from the start of the window up to the reading (`limitsAt`), extended to 100%. `fullAt(percent, start, readAt)` in `format.ts` gives the time.
- The pace ends at the time of the reading, not at now. A pace up to now would put the 100% time of an old reading too late, because the time since the reading would count as time without use.
- The text is ` → 100% ` and the day and the time in local time (`dayTime`): ` → 100% Sat 21:06`, also for the 5-hour limit (` → 100% Wed 15:31`). It follows the percent of its limit, in the same `Text` as the limits. It is plain, as the limits are.
- `limitProjection(limit, readAt, now)` returns an empty text, and the band shows no projection, in these cases: the limit has no window or no reset time, there is no reading time, the 100% time is at or after the reset, or the 100% time is not after now. The last case covers an old reading whose 100% time has passed, a limit at 100% or more, and a reset that has passed.
- `limitItems(limits, readAt, now)` gives each limit its text (`week 49%`) and its projection, in the order week, 5h, spend. `bandData` keeps the list in `BandData.limits`.
- Each projection is a part of the band of its own. The 5-hour projection leaves before the weekly projection, because the weekly limit is the more important one. The age of the limits leaves before both, so a narrow band can show a projection without the age. For this reason a projection whose time has passed is hidden.

The band must stay on one line. The desktop app wraps a line that is wider than its box, although the `Text` has `wrap: 'truncate-end'`, because its font is proportional. So the band fits itself to the available cells:

- The render hook passes `e.props.bodyColumns` to `bandEls(E, d, surface, available)`.
- `bandCells(text, isTubeShown, isOnDesktop)` gives the width of the band: the tube cells plus the cells of the text. The text holds the stage word, the label, the separators ` | ` and the prefix `ctx `.
- On the terminal, the tube is 12 cells (10 cells and the two frame characters), and each character of the text is one cell.
- On the desktop, `bodyColumns` counts cells of the code font of the app (a monospace font), but the app draws a `Text` in its proportional font, Anthropic Sans. Most characters of that font are narrower than one cell, and some are wider (`W`, `%`). So the band counts each character by its width: `desktopCells` in `format.ts` holds the advance of each printable ASCII character and of `·`, `→`, `≈` and `…`, in hundredths of a code-font cell. A character outside the table counts as 2.2 cells: wider than `W` (1.72), a full-width glyph (1 em) and an emoji of 1.35 em. The band counts the text 4% wider than the table (`DESKTOP_TEXT_FACTOR`). The tube `Svg` is 90 CSS pixels, 11.6 code-font cells, and counts as 12.
- The table comes from the font file of the app (Text Regular, Bold for the capitals of the stage words) at 1.62 code-font cells per em. The 1.62 comes from a screenshot of the desktop app: the Week tab gives the width of a code-font cell (its columns sit at 26 and 63 cells), and the band text beside it gives the em. The table estimates that band text at 49.95 cells, and the screenshot draws it at 49.90. Two later screenshots draw the band text 2 to 3% wider than the table, so the band adds 4%.
- The table belongs to one version of the desktop app. When the app changes its text font, its code font or their sizes, measure again: one screenshot with the band and the Week tab, the cell width from the columns of the Week tab, the em from the band text, and the advances from the font file of the app.
- The budget is `available - 4`. The 4 free cells are a safety margin for the estimate.
- When the band is wider than the budget, the band leaves out parts until it fits, in this order: the dimmed `+N models` suffix, the model, the context size, the age of the limits, the 5-hour projection, the weekly projection, the limits. The order is `BAND_DROP` in `view.ts`. The context size shows only without a tube, so with a tube the order is: suffix, model, age, 5-hour projection, weekly projection, limits.
- With the label of the example above (`HOT 47m left · 412k cached · $8.24 to re-warm`, one other model, a recent reading), the band shows these parts at these widths of `bodyColumns`:

| Parts | Desktop | Terminal |
|---|---|---|
| all | 128 or more | 154 or more |
| without `+1 model` | 121 to 127 | 145 to 153 |
| both projections, no model | 98 to 120 | 116 to 144 |
| the weekly projection only | 84 to 97 | 99 to 115 |
| the limits without a projection | 70 to 83 | 82 to 98 |
| the tube and its label only | below 70 | below 82 |

- The tube, the stage word and its label stay always. When they alone are wider than the budget, the terminal cuts the label at the end (`truncate-end`). The desktop app does not cut a `Text`, so there the label wraps to a second line. A band without a tube always keeps its last part, so that the line is never empty.
- Without a number for the available cells (`undefined`), the band leaves out nothing.

## Pane

The command `/token-watch` opens the pane with a requested width of 80 columns and 24 rows. The pane is a sidebar on the right in a wide window and a region above the prompt in a narrow window. The keys `1` to `5` select a tab. Esc closes the pane. With the argument `recommend`, the command opens the dialog of Recommendations instead.

### Table layout

All tables of the pane use the same rules. A grid is a set of rows between the tables of a tab, for example the head of tab 3 and the cache history of tab 2. A grid follows the same rules as a table. The head grid of tab 3 and the context row of tab 4 use the columns of the tables of their tab. The cache history of tab 2 starts with a column of 16 cells. Its label `cache, last 4 h` has 15 characters, and a column keeps one free cell. The strip therefore starts 2 cells to the right of the cause bars.

- Each column has a fixed width in terminal cells.
- A text column is left-aligned. Its text is cut to the column width minus 1, with `…` as the last character of a cut text. There is always at least one space between two columns.
- A number column is right-aligned.
- Every money amount has two decimals, in the band and in every tab: `$0.50`, `$8.24`, `$432.64`. From `$1,000.00` it has a comma as thousands separator: `$1,234.56`. Zero, a negative amount and a value that is not a number show `$0.00`. `formatMoney` in `format.ts` makes the text. A money column is 10 cells wide, so that it holds `$9,999.99` and the one free cell that `cell()` keeps.
- The header row uses the same widths and alignments as the data rows.
- One row builder, `tableEls` in `view.ts`, draws every table and every grid. It takes the columns (width and alignment), the rows and the options below. A cell is a string or a list of elements, for example a bar.
- `format.ts` cuts and pads each string cell to its width with `cell()`, so that the columns align in the terminal. A list of elements is not cut. Its builder gives it the width of its column.
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
- `resume`: the time since the previous request of the thread is more than the cache lifetime of the thread (a resume after a pause).
- `growth`: all other requests.

The cache history is a grid of two columns, 16 and 49 cells wide (65 cells). The label column is 16 cells wide because its longest label, `cache, last 4 h`, has 15 characters and a column keeps one free cell. The second column holds the strip: one cell for each 5 minutes of the last 4 hours, 48 cells, and one free cell. The mod keeps the times of the main requests of the last 4 hours in the session state for this strip. The grid has no header row. The rows are:

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
                      empty after 60 minutes. Blue is cold, red is hot.
LIVE                  A turn runs.
HOT                   More than 2/3 of the cache hour is left.
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

- The tab has seven sections: `Band above the prompt`, `1 Now`, `2 Session`, `3 Week`, `4 Why`, `Costs` and `/token-watch`. Each section starts with its heading in bold. A blank line separates two sections. The section `/token-watch` names the two forms of the command: `no argument` and `recommend`. A term holds at most 21 cells, so the heading carries the command and the terms carry its forms.
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
- A number in a term of the band is an example (`47m left`). It has the shape of the real text. A day name in a term is an example too (`→ 100% Sat 21:06`).
- When a label changes in the band or in a tab, change the term here and the copy in `tests/help-text.ts` in the same change. The test `the terms of the help tab are the labels that the band and the other tabs draw` checks the terms against the trees of the band and of the tabs.

## Recommendations

`/token-watch recommend` sends the data of the tabs to a model in one call and shows the recommendations. The call runs only after the person confirms its cost in a dialog. `hooks/recommend.ts` holds the pure functions, `hooks/view.ts` the dialog (`recommendEls`), and `hooks/register.ts` the command, the call and the counting.

### Command

- `command.run` with the argument `recommend` (after a trim) opens the dialog. Any other argument opens the pane, as before. The command registers `argumentHint: '[recommend]'`.
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
| Plan limits | Each limit with its percent, its reset, the time of 100% at the current pace (as in the band) and the age of an old reading. |
| This conversation, by model and scope | One line for each row of the Session tab: requests, input, cache write, cache read, output, cost and share. A cost from a fallback price names the key of its price. The total, and the cost that `/cost` reports. |
| Cache writes of this conversation, by cause | The three causes with tokens, cost and share, and the two cache lifetimes. |
| Cache history of this conversation | The count of the main requests in the last 4 hours, the strip of the Session tab as 48 letters (`W` warm, `c` cold, `.` before the first request), and each resume with its age and cost. |
| Context of this conversation | The context row and the categories of the Why tab, and its lists of memory files, MCP servers and custom agents. |
| This week | The start of the week, the weekly limit with its reset and projection, the highest weekly percent of each past period of 12 hours, and the tables `by repo` and `by model and scope` of the Week tab, at most 10 rows each. |
| API list prices in USD per million tokens | The newest model of each family in the price table, with its input, cache write, cache read and output price. |

The prompt holds no transcript text, no file content and no prompt text. The mod does not read the messages of the session.

### Call

- The press handler of Ask calls `$.model.complete({ model, system, prompt, maxTokens: 4000, effort: 'medium', timeoutMs: 120000 }, { signal })`.
- The model is the `userConfig` option `recommendModel`. The default is the alias `sonnet` (Sonnet 5.5 on 2026-10-07; decision of 2026-10-07). The alias resolves like `--model`, so the default follows each new Sonnet release without an edit. An empty option, or an option that is not a text, gives the default.
- The effort is `medium`. Thinking tokens count in the output cap, so a high effort could leave no room for the reply.
- The call has a time limit of 2 minutes.
- A request that the engine refuses to send (for example a model that is not allowed) rejects. The dialog then shows `The request was not sent: ` and the reason, and nothing counts.
- A result without a reply has one of three reasons (`failureText`): `The API answered with an error: <kind> (HTTP <status>).`, `The model sent a reply without text.` and `The call stopped before the reply: it was cancelled, or no reply came within 2 minutes.`
- The reply stays in the state value. The mod does not write it into the conversation, so the model of the session does not read it. The slash command note is still recorded, as for every `/token-watch`.

### Counting

- The `usage` of the call goes into `totals` and `hours` under the price model and the scope `recommend`, on every arm of the result. A call whose four counts are 0 adds nothing.
- The cost is `costOf(usage, true)`: a cache write has the 5-minute price, as in a subagent, because the call does not use the cache of a conversation.
- The causes and `main` do not change: the call is no thread of the conversation.
- The snapshot carries the hours, so the Week and the Now tab count the call too. The Session tab shows the row `sonnet ≈` `recommend`, and the Week tab the row `sonnet recommend ≈`.
- The band counts the price model among the models of the conversation, so a dimmed `+1 model` can show after a call.

### Model comparison

Pending: one run with Sonnet 5.5 and one with Opus 5.5 on the same data. Sonnet stays the default unless Opus gives clearly better recommendations.

## Data model

### Session state (`$.state`)

The state lasts for one conversation. `/clear`, `/resume` and `/branch` reset it.

- `run`: the session id, the start time and the repo of the conversation.
- `totals`: per model, per scope, the counts `input`, `output`, `cacheRead`, `cacheWrite`, `requests`, and the weighted `cost`.
- `causes`: per cause, the cache-write tokens and the weighted cost.
- `main`: `lastRequestAt`, `contextTokens`, `model`, `isWorking`, `requestTimes` (the times of the main requests of the last 4 hours) and `resumes` (the time and the weighted cost of each resume in the last 4 hours).
- `contextTokens` is input plus cache read plus cache write plus output of the last main request.
- `limits`: the last `rateLimits` list.
- `limitsAt`: the time of that reading. `session.measure` sets it to the time of the event. The limits are those of the last API response of the session, so `/clear`, `/resume` and `/branch` reload them with the `limitsAt` of the conversation before. Only without an earlier reading do they count as read at the time of the reload.
- `readings`: the limit readings of this conversation.
- `agents`: the map from `agentId` to subagent type.
- `threads`: per thread, the time of the last request.
- `hours`: the hourly buckets, keyed by UTC hour, then by `model|scope`.
- `tab`: the selected tab of the pane.
- `breakdown`: the last context breakdown, for tab 4.
- `others`: the snapshots of the shared store that the pane read last.
- `recommend`: the dialog of `/token-watch recommend`: an id, the phase (`confirm`, `asking`, `answered`, `failed`), the model, the price model, the prompt, the input estimate, the output cap, the highest cost, the reply or the reason, and the counted usage. `/clear`, `/resume` and `/branch` do not reset it.

### Shared store (`$.store`)

Each conversation writes one key, `run:<session id>:<start time>`, and no other key. The start time is the epoch milliseconds when the conversation started. `/clear`, `/resume` and `/branch` start a new conversation and a new key. Two conversations therefore never write the same key. The value:

```json
{
  "v": 1,
  "key": "run:<session id>:1791374400000",
  "sessionId": "<session id>",
  "repo": "webshop",
  "model": "claude-fable-5-1",
  "updatedAt": 1791374400000,
  "lastMainRequestAt": 1791374400000,
  "contextTokens": 412000,
  "isWorking": false,
  "readings": [{ "at": 1791374400000, "kind": "seven_day", "percentUsed": 41, "resetsAt": "2026-10-12T00:00:00Z", "seenAt": 1791378000000 }],
  "hours": { "2026-10-06T14": { "claude-fable-5-1|main": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "requests": 0, "cost": 0 } } }
}
```

- `repo` is the folder name of the session root, without a `.worktrees/<name>` or `.claude/worktrees/<name>` suffix.
- `hours` is keyed by the UTC hour of the request. Hours older than 8 days are removed when the session writes.
- The conversation keeps a reading each time a percent changes by a whole point or the reset changes, at most 400 readings. `at` is the time of the first measure of the reading. A later measure that keeps the percent within a whole point sets `seenAt` on the last reading of its kind, and does not change `at` or `percentUsed`. A reading without a later measure has no `seenAt`. The snapshot holds only the `seven_day` readings of the last 8 days.
- A conversation writes its key only after its first request.
- The session writes its key at most once every 15 seconds while it has new data, and once when the session ends.
- 5 seconds after the session start, the mod deletes each `run:` key with an `updatedAt` older than 8 days.
- The pane reads all `run:` keys when it opens, and every 15 seconds while it is shown on tab 1 or tab 3.

## Prices

The mod contains a price table for the weighting (`PRICES` in `hooks/prices.ts`). The source of the values is the Claude pricing page, read 2026-09-29. A price change needs an edit of the table in the mod.

### Fallback price

A new model has no key in the table until someone adds it. The mod does not count it with cost 0. It takes the price of the newest model of the same family.

- The id of the model loses a context suffix (`[1m]`) and a date suffix (`-20251001`). A key of the table is an exact price: `claude-opus-5-5[1m]` and `claude-haiku-4-5-20251001` are exact.
- Without an exact price, the family is the word after `claude-`: `opus` for `claude-opus-5-6`. The mod looks for the newest key of that family in the table.
- The newest key has the highest version. The version is the numbers after the family, compared number by number. A missing part counts as 0, so `5` equals `5-0`. `claude-opus-5-5` is newer than `claude-opus-5`, and `claude-opus-5` is newer than `claude-opus-4-8`.
- The newest key sets the price, also for a model with a lower version: `claude-opus-5-6` and `claude-opus-4-9` both use the price of `claude-opus-5-5`. `claude-sonnet-6` uses `claude-sonnet-5-5`.
- A model of a family that has no key (for example `claude-mythos-1`), and an id that does not start with `claude-`, have no price. The cost is 0, and the pane marks the model `unpriced`.

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

`make prices` runs `scripts/prices.mjs`. The script reads every `token-watch_*.json` file in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/` and collects the model ids from the `model` fields and from the hour bucket keys (`<model>|<scope>`). It reads the keys of `PRICES` from the text of `hooks/prices.ts`, and it applies the same rule as `prices.ts`. It prints one line for each model, sorted: the model, then `exact`, `fallback from <key>` or `unpriced`. The last line is a summary: the count of models and store files, and how many models are exact, fallback and unpriced. It exits with 0, also when a model has no price, and it prints one line when no store file exists. It is not part of `make verify`.

Node does not import TypeScript, so the rule exists twice: in `hooks/prices.ts` and in `scripts/prices-rule.mjs`. A test in `tests/prices.test.ts` checks that both give the same answer for the same table.

To update the prices: run `make prices`, read the pricing page, add the new keys to `PRICES` in `hooks/prices.ts` (with the date of the reading in the comment), and run `make prices` again. The lines with `fallback from` and `unpriced` should be gone.

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
| `scripts/prices.mjs` | `make prices`: lists the models in the store and how each one is priced. |
| `scripts/prices-rule.mjs` | The price rule of `prices.ts` for Node, and the pure helpers of `prices.mjs`. It has no import, so the tests load it. |
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
- Band width: for one, two and three models, on both surfaces and at the widths 60, 80, 100, 120, 160 and without a number, the band is never wider than the budget (`available - 4`), counted with `bandCells`, the parts leave in the order of the Band section, the suffix reads `+1 model` and `+2 models`, and the limits read `week 49% · 5h 8%`. A band whose tube, stage word and label are wider than the budget keeps them. The draw tests mount the band with a narrow and a wide `bodyColumns`.
- Band projection on both surfaces: both projections after their percents in one plain `Text`; no projection for a limit that does not reach 100% before its reset, without a reset time, and for the spend limit; at the widths 60 to 140 and at each width from 40 to 150, the model leaves, then the 5-hour projection, then the weekly projection, then the limits, and the band is never wider than the budget; an old reading keeps the times of its pace and shows its age, the age leaves before the projections, and a 5-hour time that has passed is hidden. The draw tests mount the band with both projections at 160, 120, 100 and 90 cells and after the 5-hour time has passed.
- Reading time: a measure within a whole point moves `seenAt` of the last reading of its kind and never back, `weekOf` takes the reading with the last measure, `mergeReadings` drops a `seenAt` that is not a number, the snapshot carries `seenAt`, the Week tab paces up to `seenAt` and leaves out a time that has passed, and a `/clear` after two hours keeps the reading time, so the band shows `(2h ago)` and the pace up to that reading on both surfaces.
- `fitColumns`: the table fits, one drop, several drops, no available width. A narrow tab 1 keeps the cache, the repo, `60 min` and `today`.
- Table layout: every row of each table has the same width, and each column starts at the same position in every row.
- Session labels on both surfaces: the total row has a dimmed `estimate` cell and a bold rest; the `reported` row and the note show only when Claude Code reports a cost; the note is one dimmed `Text` that is not a table row, and the tables stay aligned at every width.
- Money columns: every money column of the four tabs holds `$9,999.99` without a cut, and a Week share row shows its cents.
- Prices: the version comparison (number by number, a missing part as 0, `10` above `9`); the newest key of each family; an exact price for a date and a `[1m]` variant; the fallback price of `claude-opus-5-6` and `claude-opus-4-9` (both from `claude-opus-5-5`) and `claude-sonnet-6`; no price for `claude-mythos-1`; the cost functions with the fallback price; a hook test that stores the fallback cost of a request.
- Mark `≈` on both surfaces: the Session table and the Week table `by model and scope` show ` ≈` after the name of a fallback row, also when the name is cut, with the widths unchanged; no mark for an exact price, in the Now tab, the total row and the table `by repo`; the band reads `≈ $3.29 to re-warm` for a fallback price and has no second `≈` in the COLD label.
- `scripts/prices-rule.mjs`: the same answer as `priceInfo` for the same table, the keys read from a text, the model ids read from a store value, and the report lines.
- Week history and day axis on both surfaces: the label `week used, over time`; a future period is a dimmed `·` on the terminal and an outline rect without a fill rect in the `Svg`; the axis row has the exact names on the terminal and 7 `Box` elements of `width` 2 on the desktop; the axis starts at the weekday of the start of the week, tested for a week that starts on Sunday and one that starts on Wednesday; a week without a reading has no axis row; the head grid keeps its widths at 80, 62 and 45 columns.
- Selected row of tab 1 on both surfaces: the current row has `backgroundColor: 'selectionBg'` on its row `Box` and bold string cells, the other rows and the header have no background, no `Text` has a `backgroundColor`, no `Text` holds `>`, and the row keeps its background when columns drop. The draw tests mount the pane on both surfaces with a second session in the store, so that the engine checks the prop.
- Table options and drop orders: `dimRows`, `dimColumns`, `selectedRows` and their precedence; the kept columns of every table and grid of tabs 2 to 4 at the full width and at narrow widths; the lists of tab 4 follow the grid.
- Alignment of the four tabs on both surfaces: every row of a table or grid has the same list of column widths, every column box has `flexShrink: 0`, and on the terminal the text of a row has the length of the sum of its widths. On the desktop, no `Text` holds a bar character (`█`, `░`, an eighth block or a sparkline character), and every `Svg` sits in a `Box` with a `width` and has no `width` prop. The checks run at the full width and at a narrow width.
- Mount tests of tabs 2 to 5 on the `terminal` and the `desktop` surface: the pane is mounted, and the keys `tab-2` to `tab-5` select the tabs. Each tab draws the tree of the mod: the tab buttons are present, and the text `drawn by Claude Code` of the engine is not. The column boxes have the widths of the tab. On the desktop, each tab holds at least one `Svg` and no `Text` with a bar character. On the terminal, each tab holds no `Svg` and a `Text` with `█` or `░`.
- Help tab on both surfaces: the tab bar has the five labels `Now`, `Session`, `Week`, `Why` and `Help`, and the key `tab-5` selects the tab. Every term and every explanation of the approved text is in the tree, and the six headings are bold. The term column is a `Box` of `width: 22` and `flexShrink: 0`. The stage words, the selected row, the resume mark and the tube have the styles of the table above, and every other term is plain. The explanation is one plain `Text` with `wrap: 'wrap'`, also at 45 columns, where nothing is cut. The terms match the labels of the band and of tabs 1 to 4. The tab needs no request, reads no key of the store, and does not change when data arrives.

- Recommend, pure functions: the price model of an alias and of an id, the price source, the model option with its default, the input estimate, the highest cost with and without a price, the text of each reason of a call without a reply, the time ago, the levers and rules of the system prompt, the sections and lines of the prompt with data and without data, and the price that a fallback cost names.
- Recommend dialog on both surfaces: `/token-watch recommend` opens the pane `token-watch-recommend` as a dialog (`focus`, `closeOnEscape`, `holdToasts`, 80 columns, 18 rows) with the title, the five rows, the estimate, the output cap, the cost at the price of `sonnet-5-5`, the note on the plan, the data note and the two buttons, and no model call runs. The rows keep the label column of 15 cells and wrap the value at 80 and at 45 columns. Ask runs one call with the model, the system prompt, the cap, the effort and the time limit, and the dialog showed the estimate of that prompt. The pane opens again for the reply without `holdToasts` and with 24 rows. The reply is one `Markdown`, with the usage line. Cancel closes the dialog and runs no call. A call without a reply shows the reason, and a refused request shows why. The option `recommendModel` sets the model of the dialog and of the call. The phases and a model without a price, in `view.test.ts`.
- Recommend counting: the call goes into the hours of the snapshot under `claude-sonnet|recommend` with the cost of `costOf(usage, true)`; the Session tab shows the row on both surfaces; a call without a reply counts its tokens; a call with no tokens adds no row; Cancel while the call runs drops the reply and counts the tokens. `tests/helpers.ts` stubs `$.model.complete`: no test makes a real model call. The test engine raises no `ui.close` of the person, so Esc is covered by `closeOnEscape` in the open arguments.

`claude plugin validate --strict` passes.

## Manual verification

- CLI: start `claude --plugin-dir /path/to/token-watch`. Check the band, the cache tube over 60 minutes without input, the pane with its five tabs, and a second session in tab 1. Read tab 5 against the band and the tabs.
- Desktop app: the same checks in a Code tab session.
- Compare the session totals with the session transcript.
- `/token-watch recommend` in the CLI and in the desktop app: the dialog shows the cost, Cancel and Esc close it without a call, Ask shows the reply, and the Session tab shows the row `sonnet ≈` `recommend`.

## Installation

- Development: `claude --plugin-dir /path/to/token-watch`. The CLI reloads the mod on each save.
- Permanent use in the CLI and the desktop app: an entry for the repo path in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`.
