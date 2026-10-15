import { describe, expect, it } from 'vitest'
import { foldPieRows, seriesColor } from './chartData'

describe('seriesColor', () => {
  it('maps slots in fixed order', () => {
    expect(seriesColor(0)).toBe('var(--series-1)')
    expect(seriesColor(7)).toBe('var(--series-8)')
  })

  it('refuses to cycle past the palette', () => {
    expect(() => seriesColor(8)).toThrow('no colour slot 9')
  })
})

describe('foldPieRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ tier: `t${i}`, n: i + 1 }))

  it('keeps small inputs unchanged', () => {
    expect(foldPieRows(rows(8), 'tier', 'n')).toEqual(rows(8))
  })

  it('folds the smallest slices into Other', () => {
    const folded = foldPieRows(rows(10), 'tier', 'n')
    expect(folded).toHaveLength(8)
    expect(folded.slice(0, 7).map((r) => r.tier)).toEqual(['t9', 't8', 't7', 't6', 't5', 't4', 't3'])
    expect(folded[7]).toEqual({ tier: 'Other', n: 1 + 2 + 3 })
  })

  it('treats null values as zero', () => {
    const input = [...rows(8), { tier: 'none', n: null }]
    // values 1..8 plus null: keep 8..2, fold t0 (1) and the null (0)
    expect(foldPieRows(input, 'tier', 'n').at(-1)).toEqual({ tier: 'Other', n: 1 })
  })
})
