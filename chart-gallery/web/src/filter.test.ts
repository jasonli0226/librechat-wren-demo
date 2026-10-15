import { describe, expect, it } from 'vitest'
import { filterCharts } from './filter'
import { SUMMARIES } from './test/fixtures'

describe('filterCharts', () => {
  it('returns everything for a blank query', () => {
    expect(filterCharts(SUMMARIES, '   ')).toEqual(SUMMARIES)
  })

  it('matches title or description, case-insensitively', () => {
    expect(filterCharts(SUMMARIES, 'RETURN').map((c) => c.id)).toEqual([2])
    expect(filterCharts(SUMMARIES, 'loyalty tier').map((c) => c.id)).toEqual([3])
    expect(filterCharts(SUMMARIES, 'store').map((c) => c.id)).toEqual([1, 2])
  })
})
