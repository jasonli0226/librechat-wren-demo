import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import type { ChartSummary } from '../types'
import { chartText, rankByTables, sharedTables, tableFeatures } from './features'

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * b[i], 0)

describe('features', () => {
  it('embeds title and description', () => {
    expect(chartText(SUMMARIES[0])).toBe('Revenue by store. Completed revenue for each store.')
  })

  it('builds unit-length table vectors over one shared vocabulary', () => {
    const vectors = tableFeatures(SUMMARIES)
    const a = vectors.get(1)!.tables
    const b = vectors.get(2)!.tables
    expect(a).toHaveLength(4) // customers, orders, returns, stores
    expect(b).toHaveLength(4)
    expect(dot(a, a)).toBeCloseTo(1)
    expect(dot(a, b)).toBeCloseTo(0.5) // share "stores": 1 / sqrt(2 * 2)
    expect(dot(a, vectors.get(3)!.tables)).toBeCloseTo(0)
  })

  it('omits charts without tables', () => {
    const noTables: ChartSummary = { ...SUMMARIES[0], id: 9, tables: [] }
    expect(tableFeatures([noTables, SUMMARIES[0]]).has(9)).toBe(false)
  })

  it('lists shared tables in the other chart order', () => {
    expect(sharedTables(SUMMARIES[0], SUMMARIES[1])).toEqual(['stores'])
    expect(sharedTables(SUMMARIES[0], SUMMARIES[2])).toEqual([])
  })
})

describe('rankByTables', () => {
  const extra: ChartSummary = { ...SUMMARIES[0], id: 4, title: 'Orders by store', tables: ['orders', 'stores'] }

  it('ranks by table overlap, excludes the current chart and zero overlap', () => {
    const rows = rankByTables(SUMMARIES[0], [...SUMMARIES, extra], 5)
    expect(rows.map((r) => r.id)).toEqual([4, 2]) // same tables (1.0), then shares "stores" (0.5)
    expect(rows[0].score).toBeCloseTo(1)
    expect(rows[1].score).toBeCloseTo(0.5)
    expect(rows[0].reason).toEqual({ kind: 'fallback', becauseOf: null })
  })

  it('caps the result at k', () => {
    expect(rankByTables(SUMMARIES[0], [...SUMMARIES, extra], 1)).toHaveLength(1)
  })

  it('returns nothing for a chart without tables', () => {
    expect(rankByTables({ ...SUMMARIES[0], tables: [] }, SUMMARIES, 5)).toEqual([])
  })
})
