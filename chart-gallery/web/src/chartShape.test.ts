// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isLineShaped, scatterAxes, type ScatterAxes } from './chartShape'
import type { Row } from './dashboard/types'

type ShapeCase = {
  name: string
  chart: { x_field: string; y_fields: string[] }
  rows: Row[]
  line_shaped: boolean
  scatter: ScatterAxes | null
}

const cases: ShapeCase[] = JSON.parse(
  readFileSync(new URL('../../fixtures/chart-shapes.json', import.meta.url), 'utf-8'),
)

describe('chart shape fixtures', () => {
  it.each(cases)('$name', (c) => {
    expect(isLineShaped(c.chart, c.rows)).toBe(c.line_shaped)
    expect(scatterAxes(c.chart, c.rows)).toEqual(c.scatter)
  })

  it('never marks a case both line-shaped and scatter', () => {
    expect(cases.filter((c) => c.line_shaped && c.scatter !== null)).toEqual([])
  })
})
