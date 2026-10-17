import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DETAIL } from '../test/fixtures'
import { fail, mockApi, ok } from '../test/mockApi'
import type { ChartDetail } from '../types'
import { effectiveType, resolveLiveRows, useTileData } from './tileData'
import type { Row, TilePlan } from './types'

const SINCE = '2026-10-16T09:00:00+00:00'
const live = (rows: Row[]) => ({ rows, columns: [], truncated: false, ran_at: '2026-10-17T00:00:00+00:00' })
const chart = (id: number): ChartDetail => ({ ...DETAIL, id, updated_at: SINCE })
const plan = (id: number, type: TilePlan['type'] = 'bar'): TilePlan => ({
  chart: chart(id),
  type,
  allowed: [type, 'table'],
  confidence: null,
})
const LIVE_ROWS = [
  { store_name: 'A', return_rate: 0.5 },
  { store_name: 'B', return_rate: 0.7 },
]

describe('useTileData', () => {
  it('live rows replace loading', async () => {
    mockApi({ '/api/charts/1/data': ok(live(LIVE_ROWS)) })
    const plans = [plan(1)]
    const { result } = renderHook(() => useTileData(plans))
    expect(result.current.get(1)).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.get(1)).toEqual({ status: 'live', rows: LIVE_ROWS }))
  })

  it('a failed request shows the snapshot with its date', async () => {
    mockApi({ '/api/charts/1/data': fail(502, 'bad gateway'), '/api/charts/2/data': 'network-error' })
    const plans = [plan(1), plan(2)]
    const { result } = renderHook(() => useTileData(plans))
    const snap = { status: 'snapshot', rows: DETAIL.rows, since: SINCE }
    await waitFor(() => expect(result.current.get(1)).toEqual(snap))
    await waitFor(() => expect(result.current.get(2)).toEqual(snap))
  })

  it('requests run in parallel and are not repeated on rerender', async () => {
    const fetchMock = mockApi({
      '/api/charts/1/data': ok(live(LIVE_ROWS)),
      '/api/charts/2/data': ok(live(LIVE_ROWS)),
      '/api/charts/3/data': ok(live(LIVE_ROWS)),
    })
    const { result, rerender } = renderHook(({ plans }) => useTileData(plans), {
      initialProps: { plans: [plan(1), plan(2)] },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.get(2)?.status).toBe('live'))
    rerender({ plans: [plan(1), plan(2)] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    rerender({ plans: [plan(1), plan(2), plan(3)] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(result.current.get(3)?.status).toBe('live'))
  })
})

describe('resolveLiveRows', () => {
  it('live rows missing the y column fall back to the snapshot', () => {
    const snap = { status: 'snapshot', rows: DETAIL.rows, since: SINCE }
    expect(resolveLiveRows(plan(1), live([{ store_name: 'A' }]))).toEqual(snap)
    expect(resolveLiveRows(plan(1), live([{ store_name: 'A', return_rate: 1 }, { return_rate: 2 }]))).toEqual(snap)
  })

  it('keeps live rows whose values are null', () => {
    expect(resolveLiveRows(plan(1), live([{ store_name: 'A', return_rate: null }])).status).toBe('live')
  })

  it('empty live rows fall back to the snapshot', () => {
    expect(resolveLiveRows(plan(1), live([]))).toEqual({ status: 'snapshot', rows: DETAIL.rows, since: SINCE })
  })
})

describe('effectiveType', () => {
  it('a stat whose live data has several rows degrades to table', () => {
    const p = plan(1, 'stat')
    expect(effectiveType(p, { status: 'live', rows: LIVE_ROWS })).toBe('table')
    expect(effectiveType(p, { status: 'live', rows: [LIVE_ROWS[0]] })).toBe('stat')
  })

  it('keeps the planned type while loading or on a snapshot', () => {
    const p = plan(1, 'stat')
    expect(effectiveType(p, { status: 'loading' })).toBe('stat')
    expect(effectiveType(p, { status: 'snapshot', rows: LIVE_ROWS, since: SINCE })).toBe('stat')
  })
})
