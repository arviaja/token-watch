// The text of the approved mockup of tab 5, one explanation on one line: [term, explanation]. The tube row has an empty term, because it is drawn.
// The tests check the tab against this copy, so a change of a term or an explanation in hooks/view.ts needs a change here
export const HELP_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Band above the prompt',
    rows: [
      ['', 'Cache of this conversation. Full after each request, empty when the cache life ends: 1 hour or 5 minutes, read from the cost that Claude Code books. Blue is cold, red is hot.'],
      ['LIVE', 'A turn runs.'],
      ['HOT', 'More than 2/3 of the cache life is left.'],
      ['WARM', '1/3 to 2/3 of the cache life is left.'],
      ['COOLING', 'Less than 1/3 of the cache life is left.'],
      ['COLD', 'The cache expired. The next message writes it again.'],
      ['47m left', 'Minutes until the cache expires.'],
      ['cache life unknown', 'The mod has not read the cache life yet. The band shows the time since the last request, no countdown.'],
      ['412k cached', 'Tokens in the cache: the context.'],
      ['$8.24 to re-warm', 'What the next message costs to write them again.'],
      ['send now', 'The 1-hour cache expires within 10 minutes, and writing it again costs $1 or more.'],
      ['/clear', 'The cache is cold, and writing it again costs $1 or more. A new topic is cheaper in a new conversation.'],
      ['/compact', 'The context has 400k tokens or more, and every message reads all of it.'],
      ['slow down', 'At the pace so far the week runs out before its reset. A smaller model uses less of it.'],
      ['5h full at 15:31', 'At the pace so far the 5-hour limit fills within the hour.'],
      ['week used up', 'Past the weekly limit Claude Code bills usage credits and caches for 5 minutes.'],
      ['week 41%', 'Weekly plan limit used, as Claude Code reports it.'],
      ['lasts until reset', 'At the pace so far the week lasts until its reset.'],
      ['runs out Fri 14:00', 'At the pace so far the week runs out at this time, before its reset.'],
      ['5h 12%', '5-hour plan limit used.'],
      ['today $12.40', 'With an API key, in place of the limits: the cost of the sessions on this Mac since midnight.'],
      ['$4.10/h', 'With an API key: the cost of the last 60 minutes.'],
      ['[ details ]', 'Opens this pane, and [ close ] closes it. In the terminal: ctrl+x tab, then Enter or t.'],
      ['×', 'Hides the band in this session. /token-watch band on shows it again. In the terminal: ctrl+x tab, Tab, Enter.'],
    ],
  },
  {
    title: '1 Now',
    rows: [
      ['highlighted row', 'This session.'],
      ['ctx', 'Context tokens of the last request.'],
      ['60 min, today', 'Cost in the last 60 minutes and since midnight.'],
    ],
  },
  {
    title: '2 Session',
    rows: [
      ['scope', 'main, the type of a subagent, or recommend: the call of /token-watch recommend.'],
      ['req, input', 'Requests, and input tokens outside the cache.'],
      ['c.write, c.read', 'Tokens written to and read from the cache.'],
      ['estimate', 'Total at API prices, from the requests this mod saw.'],
      ['reported', 'The cost that Claude Code reports with /cost.'],
      ['start', 'Cache write of the first request of a thread.'],
      ['growth', 'Cache write of new context in a running thread.'],
      ['resume', 'Cache write after a pause longer than the cache life.'],
      ['cache, last 4 h', 'One cell per 5 minutes. Colour: warm. Dark: cold.'],
      ['▲ $3.37', 'A resume and the cost of its cache write.'],
    ],
  },
  {
    title: '3 Week',
    rows: [
      ['week, resets', 'Weekly limit used, and when it resets.'],
      ['at the current rate', 'When the week reaches 100% at the pace so far.'],
      ['week used, over time', 'One cell per 12 hours: the highest weekly percent. Outlines are the periods still to come.'],
      ['at API prices', 'The cost of the week at API prices: on a subscription, what the same use costs with an API key.'],
      ['by repo, by model', 'Cost since the weekly reset.'],
    ],
  },
  {
    title: '4 Why',
    rows: [
      ['context', 'What fills it: categories, memory files, MCP servers and agents, estimated as /context does.'],
    ],
  },
  {
    title: 'Costs',
    rows: [
      ['every cost', 'An estimate at API list prices. A plan does not bill them. They show where the tokens go.'],
      ['opus-5-6 ≈', 'No exact price yet: priced as the newest model of its family. make price-report lists these models.'],
      ['unpriced', 'The model has no price in the table of the mod.'],
    ],
  },
  {
    title: '/token-watch',
    rows: [
      ['no argument', 'Opens this pane, or closes it when it is open.'],
      ['band off, band on', 'Hides or shows the band in all sessions on this Mac. band on also undoes ×. The mod still counts.'],
      ['recommend', 'Asks a model for advice on this usage. A dialog shows the cost first, and the call runs only when you press Ask. On a subscription it counts against the plan allowance.'],
    ],
  },
]
