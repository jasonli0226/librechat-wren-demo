// @vitest-environment node
import { validateSpec } from '@json-render/core'
import { describe, expect, it } from 'vitest'
import type { ChartDetail } from '../types'
import { catalog } from './catalog'
import { buildRulesSpec, orderTiles, tileKey } from './rulesLayout'
import type { TilePlan, TileType } from './types'

const plan = (id: number, type: TileType, tables: string[] = ['orders']): TilePlan => ({
  chart: { id, title: `c${id}`, description: '', chart_type: 'bar', tables, updated_at: '', x_field: 'x', y_fields: ['y'], sql: '', rows: [], created_at: '' } as ChartDetail,
  type,
  allowed: [type],
  confidence: null,
})

const tiles = (plans: TilePlan[]) => {
  const spec = buildRulesSpec(plans)
  return (spec.elements['section-1']!.children ?? []).map((key) => {
    const el = spec.elements[key]!
    return [el.props.chartId, el.props.width]
  })
}

describe('buildRulesSpec', () => {
  it('puts stats first at quarter width', () => {
    expect(tiles([plan(1, 'bar'), plan(2, 'stat'), plan(3, 'stat')])).toEqual([[2, 'quarter'], [3, 'quarter'], [1, 'full']])
  })

  it('makes lines full width; bar, table, bar are half, half, full', () => {
    expect(tiles([plan(1, 'line')])).toEqual([[1, 'full']])
    expect(tiles([plan(1, 'bar'), plan(2, 'table'), plan(3, 'bar')])).toEqual([[1, 'half'], [2, 'half'], [3, 'full']])
  })

  it('does not split a pair with a line between two bars', () => {
    expect(tiles([plan(1, 'bar'), plan(2, 'line'), plan(3, 'bar')])).toEqual([[1, 'half'], [3, 'half'], [2, 'full']])
  })

  it('keeps tiles sharing a table adjacent', () => {
    const plans = [plan(1, 'bar', ['orders']), plan(2, 'bar', ['inventory']), plan(3, 'bar', ['orders'])]
    expect(orderTiles(plans).map((p) => p.chart.id)).toEqual([1, 3, 2])
  })

  it('gives every element children and passes validateSpec', () => {
    const spec = buildRulesSpec([plan(1, 'stat'), plan(2, 'line'), plan(3, 'bar')])
    expect(spec.root).toBe('dashboard')
    for (const el of Object.values(spec.elements)) expect(Array.isArray(el.children)).toBe(true)
    expect(validateSpec(spec).valid).toBe(true)
  })

  it('gives tiles {chartId, width} props accepted by the catalog', () => {
    const components = catalog.data.components as Record<string, { props: { safeParse: (v: unknown) => { success: boolean } } }>
    const spec = buildRulesSpec([plan(1, 'stat'), plan(2, 'line'), plan(3, 'stackedBar')])
    expect(spec.elements[tileKey(2)]!.props).toEqual({ chartId: 2, width: 'full' })
    for (const key of (spec.elements['section-1']!.children ?? [])) {
      const { type, props } = spec.elements[key]!
      expect(components[type].props.safeParse(props).success).toBe(true)
    }
  })
})
