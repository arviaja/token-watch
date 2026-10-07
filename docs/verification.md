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
| Totals against the session transcript | Not done. |

Automated: `make verify` passes: the dash check, the secret scan, `claude plugin validate --strict .` and `claude plugin test .`.
