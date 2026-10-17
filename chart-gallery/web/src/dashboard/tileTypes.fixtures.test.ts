// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Row } from './types'
import { fittingTypes } from './tileTypes'

type ShapeCase = { name: string; chart: { x_field: string; y_fields: string[] }; rows: Row[] }

const cases: ShapeCase[] = JSON.parse(
  readFileSync(new URL('../../../fixtures/chart-shapes.json', import.meta.url), 'utf-8'),
)

describe('fittingTypes on the shared shape fixtures', () => {
  it.each(cases)('never lists both line and scatter: $name', (c) => {
    const types = fittingTypes({ chart_type: 'bar', ...c.chart }, c.rows)
    expect(types.includes('line') && types.includes('scatter')).toBe(false)
  })
})
