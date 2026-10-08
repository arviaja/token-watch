# Verification

Manual checks in real sessions, and the automated checks.

Checks in real sessions on 2026-10-06:

| Check | Result |
|---|---|
| Band in the CLI | Passed. The gradient renders. The values agree: 62.5k tokens at the 1-hour write price of Opus 5.5 give $0.50. |
| Now tab in the CLI | Passed. The columns are aligned, the current session is marked, other sessions show, and a resumed session without a request shows as cold. |
| Band in the desktop app | First version: the gradient renders, but the 16-cell tube was wide and the line wrapped. Changed to a 10-cell SVG tube without a bulb, one model with `+N models`, and a width budget. Passed on 2026-10-06: one line with two models. |
| Now tab in the desktop app | First version: the text tubes had different lengths and the right columns were cut off. Changed to an SVG tube, fixed sub-columns and dropped columns, and the current session as a row in the selection colour. Passed on 2026-10-06. |
| Session, Week and Why tabs | Changed on 2026-10-06 to the table layout and the tube bars of the Now tab, on both surfaces. Desktop app and CLI: passed, including the week history of 14 periods. Later the same day: the `estimate` and `reported` rows, the cache history with the resume costs and the time axis, the week history with the day axis, and money with two decimals. Desktop app and CLI: passed. |
| Light theme | Text in heat colours has a contrast of at least 3:1 on white and on a dark background. The selection colour of the current row is a theme key. Desktop app in the light theme: passed on 2026-10-06. |
| Help tab | Added on 2026-10-06 with the approved text. Passed on 2026-10-06: key 5 opens it. |
| Context cost of the mod | Passed. Outside `/token-watch recommend`, the mod sends nothing to the model. In the 24 sessions that ran the mod up to 2026-10-06, the skill list that the model receives does not contain `token-watch` (checked in the session transcripts). Each `/token-watch` adds the command to the conversation, as every slash command does. |
| `/token-watch recommend` | Passed on 2026-10-07 in the CLI and in the desktop app: the dialog shows the cost, Cancel and Esc close it without a call, Ask shows the reply as Markdown with the usage line, and the store counts each call under the scope `recommend`. The comparison of Sonnet 5.5 and Opus 5.5 is in the design doc. |
| Band button and band setting in the CLI | Passed on 2026-10-08: the buttons `[ details ]` and `×` sit at the right end of the band line, before the `[-]` of Claude Code. `[ details ]` stays on the band line with the tube, the button opens the pane and then reads `[ close ]`, Esc on the pane turns it back to `[ details ]`, and `/token-watch band off` and `/token-watch band on` hide and show the band with a toast. |
| Band buttons in the desktop app | First version: the app drew no close mark for the dismiss role and showed the label `Hide the band in this session` as text, and the hotkey badge of `details` took more width, so the band wrapped. Changed to the label `×` and no hotkey on the desktop. Passed on 2026-10-08: one line with `details` and `×` at the right end, a click on `×` hides the band in that session only, and `/token-watch band on` shows it again. |
| Session without the mod of a clone | Passed on 2026-10-08: `claude --settings` with an empty `CLAUDE_CODE_PLUGIN_DIRS` starts a session without the band. A shell variable does not replace the value of `settings.json` in a live session. |
| Turn off and uninstall | Checked on 2026-10-08 in a separate config folder: `marketplace add`, `install`, `disable`, `enable`, `uninstall` and `marketplace remove` work without the directory approval. The store file of the mod stays after the uninstall and the removal of the marketplace. |
| Totals against the session transcript | Not done. |

Automated: `make verify` passes: the dash check, the secret scan, `claude plugin validate --strict .` and `claude plugin test .`.
