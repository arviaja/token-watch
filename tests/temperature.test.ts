import { expect, test } from 'claude-code/testing'
import { barSvg, fraction, heat, heatText, minutesCold, minutesLeft, sparkSvg, stageOf, stripCellAt, stripCells, stripSvg, tubeAlt, tubeCells } from '../hooks/temperature'

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
const MIN = 60_000

test('fraction falls from 1 to 0 over the 60-minute lifetime', async () => {
  expect(fraction(T0, T0, false)).toBe(1)
  expect(fraction(T0, T0 + 30 * MIN, false)).toBe(0.5)
  expect(fraction(T0, T0 + 60 * MIN, false)).toBe(0)
  expect(fraction(T0, T0 + 90 * MIN, false)).toBe(0)
})

test('fraction is 1 in a turn and null before the first request', async () => {
  expect(fraction(null, T0, true)).toBe(1)
  expect(fraction(null, T0, false)).toBeNull()
})

test('a last request in the future gives a full tube and at most 60 minutes', async () => {
  expect(fraction(T0 + 5 * MIN, T0, false)).toBe(1)
  expect(minutesLeft(T0 + 5 * MIN, T0)).toBe(60)
})

test('stageOf uses the thresholds of the spec', async () => {
  expect(stageOf(1, true)).toBe('LIVE')
  expect(stageOf(0.66, false)).toBe('HOT')
  expect(stageOf(0.65, false)).toBe('WARM')
  expect(stageOf(0.33, false)).toBe('WARM')
  expect(stageOf(0.32, false)).toBe('COOLING')
  expect(stageOf(0.01, false)).toBe('COOLING')
  expect(stageOf(0, false)).toBe('COLD')
})

test('minutesLeft rounds up and minutesCold rounds down', async () => {
  expect(minutesLeft(T0, T0 + 13 * MIN + 1)).toBe(47)
  expect(minutesLeft(T0, T0 + 61 * MIN)).toBe(0)
  expect(minutesCold(T0, T0 + 75 * MIN + 30_000)).toBe(15)
  expect(minutesCold(T0, T0 + 30 * MIN)).toBe(0)
})

test('heat interpolates between the four colour stops', async () => {
  expect(heat(0)).toBe('#378add')
  expect(heat(0.33)).toBe('#1d9e75')
  expect(heat(0.66)).toBe('#ef9f27')
  expect(heat(1)).toBe('#e24b4a')
  expect(heat(-1)).toBe('#378add')
  expect(heat(2)).toBe('#e24b4a')
  expect(heat(Number.NaN)).toBe('#378add')
})

test('heat gives named colours in the named mode', async () => {
  expect(heat(0.1, 'named')).toBe('blue')
  expect(heat(0.3, 'named')).toBe('cyan')
  expect(heat(0.6, 'named')).toBe('yellow')
  expect(heat(0.9, 'named')).toBe('red')
})

// The WCAG 2.x relative luminance of a hex colour and the contrast ratio of two colours
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const WHITE = '#ffffff'
const DARK = '#1e1e1e'
const channels = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
// 101 values from 0 to 1
const STEPS = Array.from({ length: 101 }, (_, i) => i / 100)

test('heatText keeps the colour of heat where it already reads, and scales the orange part down', async () => {
  expect(heatText(0)).toBe('#378add')
  expect(heatText(0.33)).toBe('#1d9e75')
  expect(heatText(1)).toBe('#e24b4a')
  expect(heatText(0.66)).toBe('#ca851f')
  expect(heatText(0.8)).toBe('#e17733')
  expect(heatText(0.5)).not.toBe(heat(0.5))
  expect(heatText(-1)).toBe(heatText(0))
  expect(heatText(2)).toBe(heatText(1))
  expect(heatText(Number.NaN)).toBe(heatText(0))
})

test('heatText gives the named colours of heat in the named mode', async () => {
  for (const x of [0.1, 0.3, 0.6, 0.9]) expect(heatText(x, 'named')).toBe(heat(x, 'named'))
})

test('heatText has a luminance from 0.14 to 0.30 and a contrast of at least 3 on white and on the dark background, for 101 values', async () => {
  for (const x of STEPS) {
    const color = heatText(x)
    expect(color, 'x ' + x).toMatch(/^#[0-9a-f]{6}$/)
    expect(luminance(color), 'luminance at ' + x).toBeGreaterThanOrEqual(0.14)
    expect(luminance(color), 'luminance at ' + x).toBeLessThanOrEqual(0.3)
    expect(contrast(color, WHITE), 'white at ' + x).toBeGreaterThanOrEqual(3)
    expect(contrast(color, DARK), 'dark at ' + x).toBeGreaterThanOrEqual(3)
  }
})

test('heatText keeps the hue of heat: the R, G and B channels stay in the same order', async () => {
  for (const x of STEPS) {
    const [r, g, b] = channels(heat(x))
    const [tr, tg, tb] = channels(heatText(x))
    expect(Math.sign(tr - tg), 'R and G at ' + x).toBe(Math.sign(r - g))
    expect(Math.sign(tr - tb), 'R and B at ' + x).toBe(Math.sign(r - b))
    expect(Math.sign(tg - tb), 'G and B at ' + x).toBe(Math.sign(g - b))
  }
})

test('heat alone does not read on white in the orange part, which is why text uses heatText', async () => {
  expect(contrast(heat(0.66), WHITE)).toBeLessThan(2.5)
  expect(contrast(heatText(0.66), WHITE)).toBeGreaterThanOrEqual(3)
})

test('tubeCells fills from the cold end and shows the rest as an eighth block', async () => {
  const f = fraction(T0, T0 + 13 * MIN, false) as number
  const cells = tubeCells(f, 16)
  expect(cells.length).toBe(16)
  expect(cells.slice(0, 12).every((c) => c.char === '█' && !c.isEmpty)).toBe(true)
  expect(cells[12].char).toBe('▌')
  expect(cells.slice(13).every((c) => c.char === '░' && c.isEmpty)).toBe(true)
  expect(cells[0].color).toBe(heat(0.5 / 16))
  expect(cells[15].color).toBe(heat(15.5 / 16))
})

test('tubeCells is full at 1 and empty at 0 and below one eighth', async () => {
  expect(tubeCells(1, 8).every((c) => c.char === '█')).toBe(true)
  expect(tubeCells(0, 8).every((c) => c.char === '░')).toBe(true)
  expect(tubeCells(0.01, 8)[0].char).toBe('░')
})

test('tubeCells shows a full cell when float noise puts the length just below a whole number', async () => {
  // 1 - 54 / 60 is 0.09999999999999998, so 10 cells hold 0.9999999999999998
  const f = fraction(T0, T0 + 54 * MIN, false) as number
  const cells = tubeCells(f, 10)
  expect(cells[0].char).toBe('█')
  expect(cells[0].isEmpty).toBe(false)
  expect(cells.slice(1).every((c) => c.char === '░')).toBe(true)
  expect(tubeCells(1 - 48 / 60, 20).filter((c) => c.char === '█')).toHaveLength(4)
})

test('stripCells has 48 cells and shows a cold gap', async () => {
  const now = T0 + 240 * MIN
  const times = [T0 + 10 * MIN, T0 + 200 * MIN]
  const cells = stripCells(times, now)
  expect(cells.length).toBe(48)
  expect(cells[0].char).toBe(' ')
  expect(cells[2].char).toBe('█')
  expect(cells[2].color).toBe(heat(1 - 5 / 60))
  expect(cells[20].char).toBe('░')
  expect(cells[20].color).toBe(heat(0))
  expect(cells[47].char).toBe('█')
})

test('stripCellAt gives the index of the strip cell that holds a time, and null outside the strip', async () => {
  const now = T0 + 240 * MIN
  expect(stripCellAt(T0 + 202 * MIN, now)).toBe(40)
  expect(stripCellAt(T0 + 130 * MIN, now)).toBe(25)
})

test('stripCellAt uses the cells of the strip: a cell holds the 5 minutes that end at its end', async () => {
  const now = T0 + 240 * MIN
  // A time at the moment of the render is in the last cell
  expect(stripCellAt(now, now)).toBe(47)
  // A time on the end of a cell is in that cell, one millisecond later in the next
  expect(stripCellAt(T0 + 200 * MIN, now)).toBe(39)
  expect(stripCellAt(T0 + 200 * MIN + 1, now)).toBe(40)
  // The first cell holds the 5 minutes after the start, and the start itself is out of the strip
  expect(stripCellAt(T0 + 5 * MIN, now)).toBe(0)
  expect(stripCellAt(T0 + 1, now)).toBe(0)
  expect(stripCellAt(T0, now)).toBeNull()
  expect(stripCellAt(T0 - 1 * MIN, now)).toBeNull()
  expect(stripCellAt(now + 1, now)).toBeNull()
  expect(stripCellAt(Number.NaN, now)).toBeNull()
})

test('a resume is in the first cell of the strip that is warm because of it', async () => {
  const now = T0 + 240 * MIN
  for (const at of [T0 + 100 * MIN, T0 + 137 * MIN, now]) {
    const warm = stripCells([at], now).findIndex((c) => c.char === '█')
    expect(stripCellAt(at, now)).toBe(warm)
  }
})

// The strings of the tube before the rects moved into cellRects and before the bulb went: no circle, cells from x 0
const TUBE_SVGS: [number, number, string][] = [
  [0, 8, '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="14" viewBox="0 0 72 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#328ec9" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2895a2" opacity="0.18"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#1e9d7b" opacity="0.18"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#619e5c" opacity="0.18"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#b19f3e" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#ee982a" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e97937" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#e45a44" opacity="0.18"/></svg>'],
  [0.37, 8, '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="14" viewBox="0 0 72 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#328ec9" opacity="0.18"/><rect x="0" y="1" width="8" height="12" rx="2" fill="#328ec9"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2895a2" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2895a2"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#1e9d7b" opacity="0.18"/><rect x="18" y="1" width="7.68" height="12" rx="2" fill="#1e9d7b"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#619e5c" opacity="0.18"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#b19f3e" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#ee982a" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e97937" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#e45a44" opacity="0.18"/></svg>'],
  [1, 8, '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="14" viewBox="0 0 72 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#328ec9" opacity="0.18"/><rect x="0" y="1" width="8" height="12" rx="2" fill="#328ec9"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2895a2" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2895a2"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#1e9d7b" opacity="0.18"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#1e9d7b"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#619e5c" opacity="0.18"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#619e5c"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#b19f3e" opacity="0.18"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#b19f3e"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#ee982a" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#ee982a"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e97937" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e97937"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#e45a44" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#e45a44"/></svg>'],
  [0, 10, '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="14" viewBox="0 0 90 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#338dcd" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2b93ae" opacity="0.18"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#23998e" opacity="0.18"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#2a9e70" opacity="0.18"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#699e59" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#a99f41" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e99f29" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#ec8930" opacity="0.18"/><rect x="72" y="1" width="8" height="12" rx="2" fill="#e8703b" opacity="0.18"/><rect x="81" y="1" width="8" height="12" rx="2" fill="#e45745" opacity="0.18"/></svg>'],
  [0.37, 10, '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="14" viewBox="0 0 90 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#338dcd" opacity="0.18"/><rect x="0" y="1" width="8" height="12" rx="2" fill="#338dcd"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2b93ae" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2b93ae"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#23998e" opacity="0.18"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#23998e"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#2a9e70" opacity="0.18"/><rect x="27" y="1" width="5.6" height="12" rx="2" fill="#2a9e70"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#699e59" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#a99f41" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e99f29" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#ec8930" opacity="0.18"/><rect x="72" y="1" width="8" height="12" rx="2" fill="#e8703b" opacity="0.18"/><rect x="81" y="1" width="8" height="12" rx="2" fill="#e45745" opacity="0.18"/></svg>'],
  [1, 10, '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="14" viewBox="0 0 90 14"><rect x="0" y="1" width="8" height="12" rx="2" fill="#338dcd" opacity="0.18"/><rect x="0" y="1" width="8" height="12" rx="2" fill="#338dcd"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2b93ae" opacity="0.18"/><rect x="9" y="1" width="8" height="12" rx="2" fill="#2b93ae"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#23998e" opacity="0.18"/><rect x="18" y="1" width="8" height="12" rx="2" fill="#23998e"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#2a9e70" opacity="0.18"/><rect x="27" y="1" width="8" height="12" rx="2" fill="#2a9e70"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#699e59" opacity="0.18"/><rect x="36" y="1" width="8" height="12" rx="2" fill="#699e59"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#a99f41" opacity="0.18"/><rect x="45" y="1" width="8" height="12" rx="2" fill="#a99f41"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e99f29" opacity="0.18"/><rect x="54" y="1" width="8" height="12" rx="2" fill="#e99f29"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#ec8930" opacity="0.18"/><rect x="63" y="1" width="8" height="12" rx="2" fill="#ec8930"/><rect x="72" y="1" width="8" height="12" rx="2" fill="#e8703b" opacity="0.18"/><rect x="72" y="1" width="8" height="12" rx="2" fill="#e8703b"/><rect x="81" y="1" width="8" height="12" rx="2" fill="#e45745" opacity="0.18"/><rect x="81" y="1" width="8" height="12" rx="2" fill="#e45745"/></svg>'],
]

test('barSvg keeps the output of the tube byte for byte, without the bulb', async () => {
  for (const [f, n, svg] of TUBE_SVGS) expect(barSvg(f, n)).toBe(svg)
})

test('barSvg draws the tube from x 0, with 9 px for each cell and no bulb', async () => {
  const svg = barSvg(0.55, 4)
  expect(svg).toContain('width="36" height="14" viewBox="0 0 36 14"')
  expect(svg).not.toContain('<circle')
  expect(svg).toContain('<rect x="0" y="1" width="8" height="12" rx="2" fill="' + heat(0.125) + '" opacity="0.18"/>')
  expect(svg).toContain('<rect x="9" y="1" width="8" height="12" rx="2" fill="' + heat(0.375) + '"/>')
  expect(svg).toContain('<rect x="18" y="1" width="1.6" height="12" rx="2" fill="' + heat(0.625) + '"/>')
  expect(svg.match(/<rect /g)).toHaveLength(4 + 3)
})

test('barSvg has a background rect for each cell and fill rects for the filled part, with 20 cells', async () => {
  expect(barSvg(0, 20)).toContain('width="180" height="14" viewBox="0 0 180 14"')
  expect(barSvg(1, 8)).toContain('width="72" height="14"')
  expect(barSvg(1, 10)).toContain('width="90" height="14"')
  expect(barSvg(0, 20).match(/<rect /g)).toHaveLength(20)
  expect(barSvg(0.5, 20).match(/<rect /g)).toHaveLength(30)
  expect(barSvg(0.5, 20).match(/width="8" height="12" rx="2" fill="#[0-9a-f]{6}"\/>/g)).toHaveLength(10)
  expect(barSvg(1, 20).match(/<rect /g)).toHaveLength(40)
  expect(barSvg(-1, 4).match(/<rect /g)).toHaveLength(4)
  expect(barSvg(2, 4).match(/<rect /g)).toHaveLength(8)
})

test('barSvg draws no fill rect of width 0, also when float noise leaves a trace', async () => {
  // 0.1 + 0.2 is 0.30000000000000004, so 20 cells hold 6.000000000000001
  for (const f of [0, 0.1, 0.35, 0.55, 0.7, 0.9, 0.1 + 0.2, 1 - 54 / 60, 1 - 48 / 60]) expect(barSvg(f, 20)).not.toContain('width="0"')
  // 0.09999999999999998 of 10 cells is 1 cell: a full fill rect and no sliver in the next cell
  expect(barSvg(1 - 54 / 60, 10).match(/<rect /g)).toHaveLength(11)
})

test('stripSvg draws nothing for no data, a background for a cold cell and a full cell for a warm one', async () => {
  const cold = { char: '░', color: heat(0) }
  const hot = { char: '█', color: heat(0.5) }
  const svg = stripSvg([{ char: ' ', color: '' }, cold, hot])
  expect(svg).toContain('width="27" height="14" viewBox="0 0 27 14"')
  expect(svg).not.toContain('x="0"')
  expect(svg).toContain('<rect x="9" y="1" width="8" height="12" rx="2" fill="' + heat(0) + '" opacity="0.18"/>')
  expect(svg).not.toContain('<rect x="9" y="1" width="8" height="12" rx="2" fill="' + heat(0) + '"/>')
  expect(svg).toContain('<rect x="18" y="1" width="8" height="12" rx="2" fill="' + heat(0.5) + '" opacity="0.18"/>')
  expect(svg).toContain('<rect x="18" y="1" width="8" height="12" rx="2" fill="' + heat(0.5) + '"/>')
  expect(svg.match(/<rect /g)).toHaveLength(3)
})

test('stripSvg is 14 high and has no triangle, also for the strip of a session with resumes', async () => {
  const cells = stripCells([T0 + 10 * MIN, T0 + 200 * MIN], T0 + 240 * MIN)
  const svg = stripSvg(cells)
  expect(svg).toContain('width="432" height="14" viewBox="0 0 432 14"')
  expect(svg).not.toContain('<polygon')
  expect(svg).not.toContain('height="22"')
})

// The outline of a future cell: the cell rect (8 by 12, rx 2) inset by half a pixel, with a 1 px stroke and no fill
const outline = (x: number) => '<rect x="' + (x + 0.5) + '" y="1.5" width="7" height="11" rx="1.5" fill="none" stroke="#8a8a8a" stroke-opacity="0.7" stroke-width="1"/>'

test('sparkSvg draws a column as high as its percent, at least one eighth, and an outline for a future cell', async () => {
  const svg = sparkSvg([{ percent: null, isFuture: true }, { percent: 0 }, { percent: 50 }])
  expect(svg).toContain('width="27" height="14" viewBox="0 0 27 14"')
  // The future cell at x 0 has an outline and no fill rect
  expect(svg).toContain(outline(0))
  expect(svg).not.toContain('<rect x="0" ')
  expect(svg).toContain('<rect x="9" y="1" width="8" height="12" rx="2" fill="' + heat(0) + '" opacity="0.18"/>')
  // 1/8 of 12 is 1.5, drawn on the bottom line at y 13, with a radius of at most half the height
  expect(svg).toContain('<rect x="9" y="11.5" width="8" height="1.5" rx="0.75" fill="' + heat(0) + '"/>')
  expect(svg).toContain('<rect x="18" y="1" width="8" height="12" rx="2" fill="' + heat(0.5) + '" opacity="0.18"/>')
  expect(svg).toContain('<rect x="18" y="7" width="8" height="6" rx="2" fill="' + heat(0.5) + '"/>')
  expect(svg.match(/<rect /g)).toHaveLength(5)
})

test('sparkSvg draws only a cold background for a past cell without a percent, and only an outline for a future cell', async () => {
  const back = (x: number) => '<rect x="' + x + '" y="1" width="8" height="12" rx="2" fill="' + heat(0, 'hex') + '" opacity="0.18"/>'
  // A cell with isFuture left out is a past cell
  expect(sparkSvg([{ percent: null }, { percent: null, isFuture: false }, { percent: null, isFuture: true }])).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" width="27" height="14" viewBox="0 0 27 14">' + back(0) + back(9) + outline(18) + '</svg>',
  )
  const week = sparkSvg([...Array(4).fill({ percent: null, isFuture: false }), { percent: 41, isFuture: false }, ...Array(9).fill({ percent: null, isFuture: true })])
  // The document is 14 cells wide: 4 cold backgrounds, one column (a background and a fill) and 9 outlines
  expect(week).toContain('width="126" height="14" viewBox="0 0 126 14"')
  expect(week.match(/<rect /g)).toHaveLength(4 + 2 + 9)
  for (let i = 0; i < 4; i++) expect(week).toContain(back(i * 9))
  expect(week).toContain('<rect x="36" y="1" width="8" height="12" rx="2" fill="' + heat(0.41) + '" opacity="0.18"/>')
  for (let i = 5; i < 14; i++) {
    expect(week).toContain(outline(i * 9))
    // A future cell has no rect at its own x, so it has no background and no fill
    expect(week).not.toContain('<rect x="' + i * 9 + '" ')
  }
  // The outlines are the only rects without a fill: no rect fills a future cell
  expect(week.match(/fill="none"/g)).toHaveLength(9)
  expect(week.match(/opacity="0.18"/g)).toHaveLength(4 + 1)
})

test('the outline of a future cell keeps its 1 px stroke inside the cell, in a grey that has no theme colour', async () => {
  const svg = sparkSvg([{ percent: null, isFuture: true }, { percent: null, isFuture: true }, { percent: null, isFuture: true }])
  const rects = svg.match(/<rect [^>]*\/>/g)!
  expect(rects).toHaveLength(3)
  const attr = (rect: string, name: string) => rect.match(new RegExp(' ' + name + '="([^"]*)"'))![1]
  for (const [i, rect] of rects.entries()) {
    const [x, y, width, height, rx, strokeWidth] = ['x', 'y', 'width', 'height', 'rx', 'stroke-width'].map((name) => Number(attr(rect, name)))
    expect(strokeWidth).toBe(1)
    // The stroke runs half its width to each side of the rect edge, and it must not leave the cell: x from i * 9 to i * 9 + 8, y from 1 to 13
    const half = strokeWidth / 2
    expect([x - half, y - half, x + width + half, y + height + half]).toEqual([i * 9, 1, i * 9 + 8, 13])
    // The corner radius of the cell (2) follows the inset
    expect(rx).toBe(2 - half)
    expect([attr(rect, 'fill'), attr(rect, 'stroke'), attr(rect, 'stroke-opacity')]).toEqual(['none', '#8a8a8a', '0.7'])
  }
  // One colour for the dark and the light theme: the markup holds no theme colour
  expect(svg).not.toMatch(/currentColor|var\(/)
})

test('sparkSvg fills a full column at 100 percent and clamps a value above it', async () => {
  for (const percent of [100, 140]) expect(sparkSvg([{ percent }])).toContain('<rect x="0" y="1" width="8" height="12" rx="2" fill="' + heat(1) + '"/>')
  expect(sparkSvg([])).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="14" viewBox="0 0 0 14"></svg>')
})

test('tubeAlt names the percent left, or a cold cache', async () => {
  expect(tubeAlt(0.783)).toBe('cache 78% left')
  expect(tubeAlt(1)).toBe('cache 100% left')
  expect(tubeAlt(0)).toBe('cache cold')
  expect(tubeAlt(0.004)).toBe('cache 1% left')
})
