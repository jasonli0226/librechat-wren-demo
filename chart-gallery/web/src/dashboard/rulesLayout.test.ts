// @vitest-environment node
import { validateSpec } from '@json-render/core'
import type { Spec } from '@json-render/core'
import { describe, expect, it } from 'vitest'
import type { ChartDetail } from '../types'
import { catalog } from './catalog'
import { HERO_KEY, buildRulesSpec, tileKey } from './rulesLayout'
import type { TilePlan, TileType } from './types'

const plan = (id: number, type: TileType, tables: string[] = ['orders']): TilePlan => ({
  chart: { id, title: `c${id}`, description: '', chart_type: 'bar', tables, updated_at: '', x_field: 'x', y_fields: ['y'], sql: '', rows: [], created_at: '' } as ChartDetail,
  type,
  allowed: [type],
  confidence: null,
})

const placed = (spec: Spec, key: string) =>
  (spec.elements[key]?.children ?? []).map((k) => {
    const el = spec.elements[k]!
    return [el.props.chartId, el.props.width]
  })

const tiles = (plans: TilePlan[]) => placed(buildRulesSpec(plans), 'section-1')

describe('buildRulesSpec', () => {
  it('hero is the first plan even when it is a stat', () => {
    const spec = buildRulesSpec([plan(1, 'stat'), plan(2, 'bar'), plan(3, 'stat')])
    expect(spec.elements.dashboard!.children).toEqual([HERO_KEY, 'section-1'])
    expect(spec.elements[HERO_KEY]!.type).toBe('Hero')
    expect(placed(spec, HERO_KEY)).toEqual([[1, 'full']])
    expect(tiles([plan(1, 'stat'), plan(2, 'bar'), plan(3, 'stat')])).toEqual([[3, 'quarter'], [2, 'full']])
  })

  it('single plan gives a hero and no section', () => {
    const spec = buildRulesSpec([plan(1, 'line')])
    expect(spec.elements.dashboard!.children).toEqual([HERO_KEY])
    expect(spec.elements['section-1']).toBeUndefined()
    expect(placed(spec, HERO_KEY)).toEqual([[1, 'full']])
    expect(Object.keys(spec.elements).sort()).toEqual(['dashboard', HERO_KEY, tileKey(1)].sort())
  })

  it('supporting tiles keep score order', () => {
    const plans = [plan(1, 'bar', ['orders']), plan(2, 'bar', ['inventory']), plan(3, 'bar', ['orders']), plan(4, 'bar', ['inventory'])]
    expect(buildRulesSpec(plans).elements['section-1']!.children).toEqual([tileKey(2), tileKey(3), tileKey(4)])
  })

  it('pairs halves and makes a lone leftover full', () => {
    const widths = tiles([plan(1, 'bar'), plan(2, 'bar'), plan(3, 'line'), plan(4, 'table')]).map(([, w]) => w)
    expect(widths).toEqual(['half', 'half', 'full'])
  })

  it('gives every element children and passes validateSpec', () => {
    const spec = buildRulesSpec([plan(1, 'stat'), plan(2, 'line'), plan(3, 'bar')])
    expect(spec.root).toBe('dashboard')
    for (const el of Object.values(spec.elements)) expect(Array.isArray(el.children)).toBe(true)
    expect(validateSpec(spec).valid).toBe(true)
  })

  it('gives every element props accepted by the catalog', () => {
    const components = catalog.data.components as Record<string, { props: { safeParse: (v: unknown) => { success: boolean } } }>
    const spec = buildRulesSpec([plan(1, 'stat'), plan(2, 'line'), plan(3, 'stackedBar')])
    expect(spec.elements[tileKey(2)]!.props).toEqual({ chartId: 2, width: 'half' })
    for (const { type, props } of Object.values(spec.elements)) {
      expect(components[type].props.safeParse(props).success).toBe(true)
    }
  })
})
