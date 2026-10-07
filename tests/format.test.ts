import { expect, test } from 'claude-code/testing'
import {
  ageText,
  cell,
  dayTime,
  fitColumns,
  fitList,
  formatMoney,
  formatPercent,
  formatTokens,
  historyCells,
  limitsAgeText,
  limitsText,
  line,
  markedCell,
  modelsText,
  placeMarks,
  projectionText,
  repoName,
  shortModel,
  tubeLabel,
  weekDayNames,
} from '../hooks/format'

const MIN = 60_000
const HOUR = 60 * MIN

test('formatTokens uses k, M and B with the decimal rule', async () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(1000)).toBe('1.0k')
  expect(formatTokens(10_000)).toBe('10.0k')
  expect(formatTokens(99_950)).toBe('100k')
  expect(formatTokens(411_002)).toBe('411k')
  expect(formatTokens(999_500)).toBe('1.0M')
  expect(formatTokens(31_000_000)).toBe('31.0M')
  expect(formatTokens(2_500_000_000)).toBe('2.5B')
  expect(formatTokens(-5)).toBe('0')
  expect(formatTokens(Number.NaN)).toBe('0')
})

test('formatMoney has two decimals for every amount and a thousands separator from 1,000 dollars', async () => {
  expect(formatMoney(8.22004)).toBe('$8.22')
  expect(formatMoney(0.5)).toBe('$0.50')
  expect(formatMoney(999.99)).toBe('$999.99')
  expect(formatMoney(1000)).toBe('$1,000.00')
  expect(formatMoney(1234.56)).toBe('$1,234.56')
  expect(formatMoney(1234.4)).toBe('$1,234.40')
  expect(formatMoney(9999.99)).toBe('$9,999.99')
  expect(formatMoney(12345.678)).toBe('$12,345.68')
  expect(formatMoney(1234567.891)).toBe('$1,234,567.89')
})

test('formatMoney rounds the cents and carries into the dollars', async () => {
  expect(formatMoney(8.226)).toBe('$8.23')
  expect(formatMoney(8.224)).toBe('$8.22')
  expect(formatMoney(999.996)).toBe('$1,000.00')
  expect(formatMoney(0.004)).toBe('$0.00')
})

test('formatMoney shows $0.00 for zero, a negative amount and a value that is not a number', async () => {
  expect(formatMoney(0)).toBe('$0.00')
  expect(formatMoney(-1)).toBe('$0.00')
  expect(formatMoney(-1234.56)).toBe('$0.00')
  expect(formatMoney(Number.NaN)).toBe('$0.00')
  expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('$0.00')
  expect(formatMoney(Number.NEGATIVE_INFINITY)).toBe('$0.00')
  expect(formatMoney(undefined as unknown as number)).toBe('$0.00')
})

test('markedCell puts the mark after the name and keeps the mark whole when it cuts the name', async () => {
  const column = { width: 11, align: 'left' as const }
  expect(markedCell('opus-5-6', column)).toBe('opus-5-6 ≈')
  expect(markedCell('opus-5', column)).toBe('opus-5 ≈')
  // The longest name that fits with the mark: 8 cells and the 2 of the mark leave the free cell of the column
  expect(Array.from(markedCell('opus-5-6', column))).toHaveLength(10)
  expect(markedCell('haiku-4-6', column)).toBe('haiku-4… ≈')
  expect(markedCell('sonnet-6[1m]', column)).toBe('sonnet-… ≈')
  for (const name of ['', 'a', 'opus-5-6', 'haiku-4-6', 'a-very-long-model-name']) {
    const text = markedCell(name, column)
    expect(Array.from(text).length).toBeLessThanOrEqual(column.width - 1)
    expect(text.endsWith(' ≈')).toBe(true)
    // cell() has nothing left to cut
    expect(cell(text, column)).toBe(text.padEnd(column.width))
  }
  expect(markedCell('opus-5-6', { width: 3, align: 'left' })).toBe('… ≈')
})

test('formatPercent', async () => {
  expect(formatPercent(41)).toBe('41%')
  expect(formatPercent(7.46)).toBe('7.5%')
})

test('shortModel and repoName', async () => {
  expect(shortModel('claude-fable-5-1')).toBe('fable-5-1')
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5[1m]')
  expect(shortModel('')).toBe('unknown')
  expect(repoName('/Users/me/repos/shop/webshop')).toBe('webshop')
  expect(repoName('/Users/me/repos/webshop/.worktrees/fix-1-x')).toBe('webshop')
  expect(repoName('/Users/me/repos/webshop/.claude/worktrees/abc/')).toBe('webshop')
  expect(repoName('')).toBe('unknown')
})

test('cell pads, aligns and cuts with an ellipsis', async () => {
  expect(cell('webshop', { width: 18, align: 'left' })).toBe('webshop           ')
  expect(cell('$6.10', { width: 9, align: 'right' })).toBe('    $6.10')
  expect(cell('data-pipeline-config', { width: 18, align: 'left' })).toBe('data-pipeline-co… ')
  expect(Array.from(cell('████▌░░░', { width: 24, align: 'left' })).length).toBe(24)
})

test('cell keeps a money amount of nine characters in a column of 10 and cuts it in a column of 9', async () => {
  expect(cell('$9,999.99', { width: 10, align: 'right' })).toBe(' $9,999.99')
  expect(cell('$9,999.99', { width: 9, align: 'right' })).toBe(' $9,999.…')
})

test('line joins cells to the sum of the column widths', async () => {
  const columns = [
    { width: 4, align: 'left' as const },
    { width: 5, align: 'right' as const },
  ]
  expect(line(['ab', '12'], columns)).toBe('ab     12')
  expect(line(['abcdef', '123456'], columns).length).toBe(9)
})

test('limitsText orders the limits and shows the age of an old reading', async () => {
  const now = Date.UTC(2026, 9, 6, 12, 0)
  const limits = [
    { kind: 'five_hour', percentUsed: 12 },
    { kind: 'seven_day', percentUsed: 41 },
  ]
  expect(limitsText(limits, now - 5 * MIN, now)).toBe('week 41% · 5h 12%')
  expect(limitsText(limits, now - 2 * HOUR, now)).toBe('week 41% · 5h 12% (2h ago)')
  expect(limitsText([{ kind: 'other', percentUsed: 3 }], now, now)).toBe('other 3%')
  expect(limitsText([], now, now)).toBe('')
  expect(ageText(45 * MIN)).toBe('45m')
})

test('limitsText joins the limits with a dot, and without the age when limitsAt is null', async () => {
  const now = Date.UTC(2026, 9, 6, 12, 0)
  const limits = [
    { kind: 'seven_day', percentUsed: 49 },
    { kind: 'five_hour', percentUsed: 8 },
    { kind: 'spend_limit', percentUsed: 3 },
  ]
  expect(limitsText(limits, now, now)).toBe('week 49% · 5h 8% · spend 3%')
  expect(limitsText(limits.slice(0, 1), now, now)).toBe('week 49%')
  expect(limitsText(limits, null, now)).toBe('week 49% · 5h 8% · spend 3%')
  expect(limitsText(limits, now - 3 * HOUR, now)).toBe('week 49% · 5h 8% · spend 3% (3h ago)')
})

test('limitsAgeText names the age of a reading that is older than 30 minutes', async () => {
  const now = Date.UTC(2026, 9, 6, 12, 0)
  expect(limitsAgeText(now - 30 * MIN, now)).toBe('')
  expect(limitsAgeText(now - 31 * MIN, now)).toBe('(31m ago)')
  expect(limitsAgeText(now - 2 * HOUR, now)).toBe('(2h ago)')
  expect(limitsAgeText(null, now)).toBe('')
})

test('tubeLabel gives the text for each stage', async () => {
  const t0 = Date.UTC(2026, 9, 6, 12, 0)
  expect(tubeLabel('HOT', t0, t0 + 13 * MIN, 411_002, 8.22004)).toBe('47m left · 411k cached · $8.22 to re-warm')
  expect(tubeLabel('COLD', t0, t0 + 75 * MIN, 411_002, 8.22004)).toBe('15m · next message re-writes 411k ≈ $8.22')
  expect(tubeLabel('HOT', t0, t0 + 13 * MIN, 411_002, null)).toBe('47m left · 411k cached')
  expect(tubeLabel('COLD', t0, t0 + 75 * MIN, 411_002, null)).toBe('15m · next message re-writes 411k')
  expect(tubeLabel('LIVE', t0, t0, 411_002, 8.22)).toBe('in turn · 411k cached')
  expect(tubeLabel('LIVE', null, t0, 0, 0)).toBe('in turn')
})

test('tubeLabel puts ≈ before the re-warm cost of a fallback price, and keeps the COLD label as it is', async () => {
  const t0 = Date.UTC(2026, 9, 6, 12, 0)
  expect(tubeLabel('HOT', t0, t0 + 13 * MIN, 411_002, 8.22004, true)).toBe('47m left · 411k cached · ≈ $8.22 to re-warm')
  expect(tubeLabel('HOT', t0, t0 + 13 * MIN, 411_002, 8.22004, false)).toBe('47m left · 411k cached · $8.22 to re-warm')
  expect(tubeLabel('COLD', t0, t0 + 75 * MIN, 411_002, 8.22004, true)).toBe('15m · next message re-writes 411k ≈ $8.22')
  expect(tubeLabel('HOT', t0, t0 + 13 * MIN, 411_002, null, true)).toBe('47m left · 411k cached')
  expect(tubeLabel('LIVE', t0, t0, 411_002, 8.22, true)).toBe('in turn · 411k cached')
})

test('modelsText shows cache read, cache write and output per model', async () => {
  const counts = { input: 2, output: 1000, cacheRead: 400_000, cacheWrite: 10_000, requests: 1, cost: 1 }
  expect(modelsText([{ model: 'claude-fable-5-1', counts }])).toBe('fable-5-1 r400k w10.0k o1.0k')
  expect(modelsText([{ model: 'unknown-model', counts: { ...counts, cost: 0 } }])).toBe('unknown-model r400k w10.0k o1.0k')
})

test('dayTime and projectionText use local time', async () => {
  const start = new Date(2026, 9, 4, 11, 0).getTime()
  const resetAt = start + 7 * 24 * HOUR
  expect(dayTime(new Date(2026, 9, 9, 16, 0).getTime())).toBe('Fri 16:00')
  expect(projectionText(50, start, start + 42 * HOUR, resetAt)).toBe('100% on Wed 23:00')
  expect(projectionText(10, start, start + 42 * HOUR, resetAt)).toBe('below 100% at reset')
  expect(projectionText(null, start, start + HOUR, null)).toBe('')
  expect(projectionText(50, start, start + HOUR, null)).toBe('')
  expect(projectionText(0, start, start + HOUR, resetAt)).toBe('below 100% at reset')
  expect(projectionText(50, start, start, resetAt)).toBe('below 100% at reset')
})

test('historyCells takes the highest weekly reading of each 12 hours', async () => {
  const start = Date.UTC(2026, 9, 4, 9, 0)
  const readings = [
    { at: start + HOUR, kind: 'seven_day', percentUsed: 5 },
    { at: start + 2 * HOUR, kind: 'seven_day', percentUsed: 13 },
    { at: start + 2 * HOUR, kind: 'five_hour', percentUsed: 90 },
    { at: start + 30 * HOUR, kind: 'seven_day', percentUsed: 50 },
  ]
  const cells = historyCells(readings, start, start + 40 * HOUR)
  expect(cells.length).toBe(14)
  expect(cells[0]).toEqual({ char: '▂', percent: 13, isFuture: false })
  expect(cells[1]).toEqual({ char: '░', percent: null, isFuture: false })
  expect(cells[2]).toEqual({ char: '▅', percent: 50, isFuture: false })
  expect(cells[3]).toEqual({ char: '░', percent: null, isFuture: false })
  expect(cells[4]).toEqual({ char: ' ', percent: null, isFuture: true })
})

test('historyCells returns the 14 periods of the week: past readings, past empty cells and future cells', async () => {
  // The week starts on Sunday 11:00 and now is Tuesday 18:00, inside period 4 (Tuesday 11:00 to 23:00)
  const start = Date.UTC(2026, 9, 4, 11, 0)
  const now = Date.UTC(2026, 9, 6, 18, 0)
  const readings = [
    { at: Date.UTC(2026, 9, 6, 12, 0), kind: 'seven_day', percentUsed: 30 },
    { at: Date.UTC(2026, 9, 6, 17, 0), kind: 'seven_day', percentUsed: 41 },
  ]
  const cells = historyCells(readings, start, now)
  expect(cells).toHaveLength(14)
  for (let i = 0; i < 4; i++) expect(cells[i], 'period ' + i).toEqual({ char: '░', percent: null, isFuture: false })
  expect(cells[4]).toEqual({ char: '▄', percent: 41, isFuture: false })
  for (let i = 5; i < 14; i++) expect(cells[i], 'period ' + i).toEqual({ char: ' ', percent: null, isFuture: true })
  expect(cells.map((c) => c.char).join('')).toBe('░░░░▄' + ' '.repeat(9))
})

test('historyCells treats a period that starts at now as a future cell, and a week that has not started as 14 future cells', async () => {
  const start = Date.UTC(2026, 9, 4, 11, 0)
  const future = (cells: ReturnType<typeof historyCells>) => cells.map((c) => c.isFuture)
  expect(future(historyCells([], start, start + 12 * HOUR))).toEqual([false, ...Array(13).fill(true)])
  expect(future(historyCells([], start, start + 12 * HOUR + 1))).toEqual([false, false, ...Array(12).fill(true)])
  expect(future(historyCells([], start, start))).toEqual(Array(14).fill(true))
  expect(future(historyCells([], start, start - HOUR))).toEqual(Array(14).fill(true))
  // The last period ends the week, and a reading after the week has no cell
  const late = [{ at: start + 7 * 24 * HOUR + HOUR, kind: 'seven_day', percentUsed: 80 }]
  const cells = historyCells(late, start, start + 8 * 24 * HOUR)
  expect(cells).toHaveLength(14)
  expect(cells.every((c) => c.percent === null && !c.isFuture)).toBe(true)
})

test('historyCells ignores a reading whose percent is not a finite number', async () => {
  const start = Date.UTC(2026, 9, 4, 11, 0)
  const bad = [NaN, Infinity, -Infinity, undefined as unknown as number, '40' as unknown as number]
  const readings = bad.map((percentUsed) => ({ at: start + HOUR, kind: 'seven_day', percentUsed }))
  const none = historyCells(readings, start, start + 24 * HOUR)
  expect(none[0]).toEqual({ char: '░', percent: null, isFuture: false })
  // A finite reading in the same period still counts
  const some = historyCells([...readings, { at: start + 2 * HOUR, kind: 'seven_day', percentUsed: 20 }], start, start + 24 * HOUR)
  expect(some[0]).toEqual({ char: '▂', percent: 20, isFuture: false })
  expect(historyCells(readings, start, start + 24 * HOUR).every((c) => c.char !== undefined)).toBe(true)
})

test('weekDayNames returns the 7 day letters from the weekday of the start, in local time', async () => {
  expect(weekDayNames(new Date(2026, 9, 4, 11, 0).getTime())).toEqual(['S ', 'M ', 'T ', 'W ', 'T ', 'F ', 'S '])
  expect(weekDayNames(new Date(2026, 9, 7, 11, 0).getTime())).toEqual(['W ', 'T ', 'F ', 'S ', 'S ', 'M ', 'T '])
  expect(weekDayNames(new Date(2026, 9, 10, 23, 30).getTime())).toEqual(['S ', 'S ', 'M ', 'T ', 'W ', 'T ', 'F '])
  // The name of day i is the weekday of start + i * 24 h, and it is the weekday of both history periods of that day
  const start = new Date(2026, 9, 7, 11, 0).getTime()
  const names = weekDayNames(start)
  for (let i = 0; i < 14; i++) expect(names[Math.floor(i / 2)], 'period ' + i).toBe(['S ', 'M ', 'T ', 'W ', 'T ', 'F ', 'S '][new Date(start + i * 12 * HOUR).getDay()])
})

test('fitColumns keeps every column when the table fits or the room is unknown', async () => {
  expect(fitColumns([2, 24, 18], [2, 1], 44)).toEqual([0, 1, 2])
  expect(fitColumns([2, 24, 18], [2, 1], 100)).toEqual([0, 1, 2])
  expect(fitColumns([2, 24, 18], [2, 1], undefined)).toEqual([0, 1, 2])
})

test('fitColumns drops one column in the drop order when the table is too wide', async () => {
  expect(fitColumns([2, 24, 18], [2, 1], 43)).toEqual([0, 1])
  expect(fitColumns([2, 24, 18], [1, 2], 43)).toEqual([0, 2])
})

test('fitColumns drops several columns, and stops when the order is used up', async () => {
  expect(fitColumns([2, 24, 18, 12], [3, 2, 1], 30)).toEqual([0, 1])
  expect(fitColumns([2, 24, 18, 12], [3, 2], 10)).toEqual([0, 1])
  expect(fitColumns([2, 24, 18], [], 10)).toEqual([0, 1, 2])
})

test('fitList joins the items and keeps all of them when they fit', async () => {
  expect(fitList(['$1.00', '$2.00'], 12)).toBe('$1.00, $2.00')
  expect(fitList(['$1.00', '$2.00'], 100)).toBe('$1.00, $2.00')
  expect(fitList(['$1.00'], 5)).toBe('$1.00')
  expect(fitList([], 10)).toBe('')
})

test('fitList keeps the last items that fit after an ellipsis', async () => {
  const items = ['$1.00', '$2.00', '$3.00', '$4.00']
  expect(fitList(items, 26)).toBe('$1.00, $2.00, $3.00, $4.00')
  expect(fitList(items, 25)).toBe('… $2.00, $3.00, $4.00')
  expect(fitList(items, 21)).toBe('… $2.00, $3.00, $4.00')
  expect(fitList(items, 20)).toBe('… $3.00, $4.00')
  expect(fitList(items, 14)).toBe('… $3.00, $4.00')
  expect(fitList(items, 13)).toBe('… $4.00')
  expect(fitList(items, 7)).toBe('… $4.00')
})

test('fitList gives an ellipsis when no item fits, and counts characters, not code units', async () => {
  expect(fitList(['$1.00', '$2.00', '$3.00', '$4.00'], 6)).toBe('…')
  expect(fitList(['$100.00'], 0)).toBe('…')
  expect(fitList(['😀😀', '😀😀'], 6)).toBe('😀😀, 😀😀')
  expect(fitList(['😀😀', '😀😀'], 5)).toBe('… 😀😀')
})

const mark = (cell: number, cost: string) => ({ cell, cost })

test('placeMarks gives a label to each mark that has room, and no list', async () => {
  // A label is the mark, a space and the cost: 7 cells for $7.60. The last cell of the 49 stays free, so cell 41 is the last cell for it
  expect(placeMarks([mark(41, '$7.60')], 49)).toEqual({ marks: [{ cell: 41, cost: '$7.60' }], list: null })
  expect(placeMarks([mark(10, '$3.37'), mark(38, '$0.27')], 49)).toEqual({ marks: [{ cell: 10, cost: '$3.37' }, { cell: 38, cost: '$0.27' }], list: null })
  expect(placeMarks([], 49)).toEqual({ marks: [], list: null })
  // The input can come in any order
  expect(placeMarks([mark(38, '$0.27'), mark(10, '$3.37')], 49).marks.map((m) => m.cell)).toEqual([10, 38])
})

test('placeMarks needs the length of the label plus one free cell before the next mark', async () => {
  // $3.37 has a label of 7 cells: it ends in cell 16, and cell 17 stays free
  expect(placeMarks([mark(10, '$3.37'), mark(18, '$0.27')], 49).marks[0]).toEqual({ cell: 10, cost: '$3.37' })
  expect(placeMarks([mark(10, '$3.37'), mark(17, '$0.27')], 49).marks[0]).toEqual({ cell: 10, cost: null })
  // A longer cost needs more room
  expect(placeMarks([mark(10, '$1,234.56'), mark(22, '$0.27')], 49).marks[0]).toEqual({ cell: 10, cost: '$1,234.56' })
  expect(placeMarks([mark(10, '$1,234.56'), mark(21, '$0.27')], 49).marks[0]).toEqual({ cell: 10, cost: null })
  // The end of the row is the next mark of the last label
  expect(placeMarks([mark(41, '$7.60')], 49).marks[0].cost).toBe('$7.60')
  expect(placeMarks([mark(42, '$7.60')], 49).marks[0].cost).toBeNull()
})

test('placeMarks shows only the mark for a label with no room, and puts its cost in a list after the last item', async () => {
  // Two resumes close together: the first has no room, the second keeps its label, and the list starts 2 cells after it
  const close = placeMarks([mark(10, '$3.37'), mark(14, '$0.27')], 49)
  expect(close.marks).toEqual([{ cell: 10, cost: null }, { cell: 14, cost: '$0.27' }])
  expect(close.list).toEqual({ at: 14 + 7 + 2, text: '$3.37' })
  // Costs of several marks go in time order, separated by commas
  const three = placeMarks([mark(5, '$1.00'), mark(8, '$2.00'), mark(11, '$3.00')], 49)
  expect(three.marks).toEqual([{ cell: 5, cost: null }, { cell: 8, cost: null }, { cell: 11, cost: '$3.00' }])
  expect(three.list).toEqual({ at: 11 + 7 + 2, text: '$1.00, $2.00' })
  // A lone mark between two labels: its cost goes after the last item
  const edge = placeMarks([mark(5, '$1.00'), mark(30, '$2.00'), mark(33, '$3.00')], 49)
  expect(edge.marks).toEqual([{ cell: 5, cost: '$1.00' }, { cell: 30, cost: null }, { cell: 33, cost: '$3.00' }])
  expect(edge.list).toEqual({ at: 33 + 7 + 2, text: '$2.00' })
})

test('placeMarks gives the mark of one cell to the later resume, and the cost of the earlier one to the list', async () => {
  const same = placeMarks([mark(20, '$1.00'), mark(20, '$2.00')], 49)
  expect(same.marks).toEqual([{ cell: 20, cost: '$2.00' }])
  expect(same.list).toEqual({ at: 20 + 7 + 2, text: '$1.00' })
})

test('placeMarks puts the list before the first mark without a label when it does not fit after the last item', async () => {
  // A resume in the last cells has no room for its label or for a list behind it: the list ends 2 cells before the mark
  const recent = placeMarks([mark(46, '$3.37')], 49)
  expect(recent.marks).toEqual([{ cell: 46, cost: null }])
  expect(recent.list).toEqual({ at: 46 - 2 - 5, text: '$3.37' })
  // An earlier label stays where it is, and the list sits at the mark that it belongs to
  const both = placeMarks([mark(10, '$3.37'), mark(44, '$0.27')], 49)
  expect(both.marks).toEqual([{ cell: 10, cost: '$3.37' }, { cell: 44, cost: null }])
  expect(both.list).toEqual({ at: 44 - 2 - 5, text: '$0.27' })
  // The list keeps 2 free cells to the item before it: the label ends in cell 16 and the list can start in cell 19 at the earliest
  expect(placeMarks([mark(10, '$3.37'), mark(26, '$0.27')], 27).list).toEqual({ at: 19, text: '$0.27' })
  // The list stays after the last item when it fits there: in a row of 48 cells it has the cells 42 to 46
  expect(placeMarks([mark(30, '$1.00'), mark(33, '$0.27')], 48).list).toEqual({ at: 33 + 7 + 2, text: '$1.00' })
  // It moves before the first item when it is one cell too long for the place behind the last item
  expect(placeMarks([mark(30, '$1.00'), mark(33, '$0.27')], 47).list).toEqual({ at: 30 - 2 - 5, text: '$1.00' })
})

test('placeMarks keeps the newest costs behind an ellipsis when the list fits nowhere, and never cuts a cost', async () => {
  // Nine resumes in nine cells: only the last one has room for its label
  const marks = Array.from({ length: 9 }, (_, i) => mark(i, '$' + (100 + i) + '.50'))
  const placed = placeMarks(marks, 49)
  expect(placed.marks.slice(0, 8).every((m) => m.cost === null)).toBe(true)
  expect(placed.marks[8]).toEqual({ cell: 8, cost: '$108.50' })
  // The label of the last mark ends in cell 16, the list starts 2 cells later and has 29 cells
  expect(placed.list).toEqual({ at: 19, text: '… $105.50, $106.50, $107.50' })
})

test('placeMarks drops the list when there is no room for even one cell of it', async () => {
  // The mark in cell 0 has no room for its label (the next mark is in cell 1), and the mark in the last cell has none behind it
  const none = placeMarks([mark(0, '$1.00'), mark(1, '$2.00'), mark(47, '$3.00')], 49)
  expect(none.marks).toEqual([{ cell: 0, cost: null }, { cell: 1, cost: '$2.00' }, { cell: 47, cost: null }])
  expect(none.list).toBeNull()
})
