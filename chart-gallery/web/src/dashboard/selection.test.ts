import { describe, expect, it } from 'vitest'
import type { ChartSummary } from '../types'
import { dashboardHref, parseDashboardParams, selectCharts } from './selection'

const parse = (qs: string) => parseDashboardParams(new URLSearchParams(qs))

function chart(id: number): ChartSummary {
  return {
    id,
    title: `Chart ${id}`,
    description: '',
    chart_type: 'bar',
    tables: [],
    updated_at: '2026-01-01T00:00:00Z',
  } as ChartSummary
}
const ranked = (id: number, confidence: number) => ({ item: chart(id), confidence })

describe('parseDashboardParams', () => {
  it('parses from, min, max with clamping', () => {
    expect(parse('?from=3&min=2&max=40')).toEqual({
      source: { kind: 'chart', id: 3 },
      min: 1,
      max: 12,
    })
  })

  it('rejects both or neither source', () => {
    expect(parse('?from=3&q=x').source).toBeNull()
    expect(parse('?').source).toBeNull()
    expect(parse('?q=%20').source).toBeNull()
  })

  it('bad numbers fall back to defaults', () => {
    const p = parse('?q=x&min=abc&max=-1')
    expect(p.min).toBe(0.3)
    expect(p.max).toBe(1)
    const d = parse('?q=x&min=&max=')
    expect(d.min).toBe(0.3)
    expect(d.max).toBe(6)
  })

  it('rounds max down and trims/truncates q', () => {
    expect(parse('?q=x&max=4.9').max).toBe(4)
    const p = parse(`?q=${encodeURIComponent('  ' + 'a'.repeat(300) + '  ')}`)
    expect(p.source).toEqual({ kind: 'query', q: 'a'.repeat(200) })
  })

  it('rejects an invalid from id', () => {
    expect(parse('?from=abc').source).toBeNull()
  })
})

describe('dashboardHref', () => {
  it('encodes the query', () => {
    expect(dashboardHref({ kind: 'query', q: 'a&b' })).toBe('/dashboard?q=a%26b')
  })

  it('appends min and max after the source', () => {
    expect(dashboardHref({ kind: 'chart', id: 3 }, 0.6, 4)).toBe('/dashboard?from=3&min=0.6&max=4')
    expect(dashboardHref({ kind: 'chart', id: 3 }, undefined, 4)).toBe('/dashboard?from=3&max=4')
  })
})

describe('selectCharts', () => {
  const fallback = [chart(1), chart(2), chart(3), chart(4)]

  it('keeps confidence >= min, seed first, caps at max including seed', () => {
    const r = selectCharts({
      seed: chart(9),
      ranked: [ranked(9, 1), ranked(5, 0.9), ranked(6, 0.4), ranked(7, 0.5), ranked(8, 0.8)],
      fallback,
      min: 0.5,
      max: 3,
    })
    expect(r).toEqual({
      picked: [
        { id: 9, confidence: null },
        { id: 5, confidence: 0.9 },
        { id: 7, confidence: 0.5 },
      ],
      usedFallback: false,
      belowThreshold: false,
    })
  })

  it('falls back when ranked is null and ignores min', () => {
    const r = selectCharts({ seed: chart(2), ranked: null, fallback, min: 1, max: 3 })
    expect(r).toEqual({
      picked: [
        { id: 2, confidence: null },
        { id: 1, confidence: null },
        { id: 3, confidence: null },
      ],
      usedFallback: true,
      belowThreshold: false,
    })
  })

  it('below threshold keeps the seed alone', () => {
    const r = selectCharts({ seed: chart(9), ranked: [ranked(5, 0.1)], fallback, min: 0.5, max: 6 })
    expect(r).toEqual({
      picked: [{ id: 9, confidence: null }],
      usedFallback: false,
      belowThreshold: true,
    })
  })

  it('keeps the best match alone without a seed', () => {
    const r = selectCharts({
      seed: null,
      ranked: [ranked(5, 0.2), ranked(6, 0.4)],
      fallback,
      min: 0.5,
      max: 6,
    })
    expect(r.picked).toEqual([{ id: 6, confidence: 0.4 }])
    expect(r.belowThreshold).toBe(true)
  })

  it('returns nothing when there are no ranked items and no seed', () => {
    const r = selectCharts({ seed: null, ranked: [], fallback, min: 0.5, max: 6 })
    expect(r.picked).toEqual([])
  })
})
