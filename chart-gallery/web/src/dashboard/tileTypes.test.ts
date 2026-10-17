import { describe, expect, it } from 'vitest'
import type { ChartDetail } from '../types'
import { fittingTypes, isNumeric, planTiles } from './tileTypes'
import type { Row } from './types'

const shape = (chart_type: ChartDetail['chart_type'], x_field = 'k', y_fields = ['v']) => ({
  chart_type,
  x_field,
  y_fields,
})

const categories = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ k: `c${i}`, v: i + 1 }))

const detail = (id: number, rows: Row[], chart_type: ChartDetail['chart_type'] = 'bar'): ChartDetail => ({
  id,
  title: `t${id}`,
  description: '',
  chart_type,
  tables: [],
  updated_at: '',
  x_field: 'k',
  y_fields: ['v'],
  sql: '',
  rows,
  created_at: '',
})

describe('fittingTypes', () => {
  it('one numeric row is a stat', () => {
    const types = fittingTypes(shape('bar'), [{ k: 'a', v: 5 }])
    expect(types[0]).toBe('stat')
    expect(types[types.length - 1]).toBe('table')
  })

  it('date x is a line, even with 200 rows', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      k: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      v: i,
    }))
    expect(fittingTypes(shape('line'), rows)).toEqual(['line', 'table'])
  })

  it('saved pie with <=7 categories is a stacked bar; 8 is a bar', () => {
    expect(fittingTypes(shape('pie'), categories(7))[0]).toBe('stackedBar')
    expect(fittingTypes(shape('pie'), categories(8))[0]).toBe('bar')
  })

  it('more than 20 categories is a table', () => {
    expect(fittingTypes(shape('bar'), categories(21))).toEqual(['table'])
  })

  it('y fields 1000x apart are a table', () => {
    const rows = [
      { k: 'a', x: 1, y: 1000 },
      { k: 'b', x: 2, y: 2000 },
    ]
    expect(fittingTypes(shape('bar', 'k', ['x', 'y']), rows)).toEqual(['table'])
  })

  it('y fields within 100x of each other still fit a bar', () => {
    const rows = [
      { k: 'a', x: 10, y: 1000 },
      { k: 'b', x: 20, y: 500 },
    ]
    expect(fittingTypes(shape('bar', 'k', ['x', 'y']), rows)).toEqual(['bar', 'table'])
  })

  it('null, string and NaN y values are not numeric', () => {
    expect(fittingTypes(shape('bar'), [{ k: 'a', v: null }])).not.toContain('stat')
    expect(isNumeric('12')).toBe(false)
    expect(isNumeric(NaN)).toBe(false)
    expect(isNumeric(Infinity)).toBe(false)
    expect(isNumeric(12)).toBe(true)
  })

  it('a y field with no numeric values does not fit a bar', () => {
    const rows = categories(3).map((r) => ({ ...r, v: 'n/a' }))
    expect(fittingTypes(shape('bar'), rows)).toEqual(['table'])
  })

  it('zero rows fit only table', () => {
    expect(fittingTypes(shape('bar'), [])).toEqual(['table'])
  })
})

describe('planTiles', () => {
  it('switches the second of two bars to a table', () => {
    const plans = planTiles([
      { chart: detail(1, categories(5)), confidence: 0.9 },
      { chart: detail(2, categories(5)), confidence: null },
    ])
    expect(plans.map((p) => p.type)).toEqual(['bar', 'table'])
    expect(plans[1].allowed).toEqual(['bar', 'table'])
    expect(plans[1].confidence).toBeNull()
  })

  it('leaves a table alone when bar is not allowed', () => {
    const plans = planTiles([
      { chart: detail(1, categories(30)), confidence: null },
      { chart: detail(2, categories(30)), confidence: null },
    ])
    expect(plans.map((p) => p.type)).toEqual(['table', 'table'])
  })

  it('does not mutate its input', () => {
    const input = [
      { chart: detail(1, categories(5)), confidence: null },
      { chart: detail(2, categories(5)), confidence: null },
    ]
    const copy = structuredClone(input)
    planTiles(input)
    expect(input).toEqual(copy)
  })
})
