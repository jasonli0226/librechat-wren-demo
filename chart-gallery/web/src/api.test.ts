import { describe, expect, it, vi } from 'vitest'
import { ApiError, arrangeDashboard, fetchChart, fetchChartData, fetchCharts } from './api'
import { DETAIL, SUMMARIES } from './test/fixtures'
import { fail, mockApi, ok } from './test/mockApi'

describe('api', () => {
  it('returns the list data', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    await expect(fetchCharts()).resolves.toEqual(SUMMARIES)
  })

  it('returns one chart', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL) })
    await expect(fetchChart(2)).resolves.toEqual(DETAIL)
  })

  it('raises the envelope error with its status', async () => {
    mockApi({ '/api/charts/9': fail(404, 'chart not found') })
    await expect(fetchChart(9)).rejects.toEqual(new ApiError('chart not found', 404))
    await expect(fetchChart(9)).rejects.toMatchObject({ status: 404 })
  })

  it('explains a network failure', async () => {
    mockApi({ '/api/charts': 'network-error' })
    await expect(fetchCharts()).rejects.toMatchObject({ message: 'Chart gallery API is unreachable', status: 0 })
  })

  it('handles a non-JSON error page', async () => {
    mockApi({ '/api/charts': { raw: '<html>bad gateway</html>', status: 502 } })
    await expect(fetchCharts()).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 })
  })

  it('arrangeDashboard posts tiles as JSON and returns spec and headlines', async () => {
    const result = { spec: '{"root":"a"}', headlines: { '1': { total: 5 } } }
    const fetchMock = mockApi({ 'POST /api/dashboards/arrange': ok(result) })
    const tiles = [{ chart_id: 1, type: 'bar' as const, allowed_types: ['bar' as const, 'table' as const] }]
    await expect(arrangeDashboard(tiles)).resolves.toEqual(result)
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ tiles })
  })

  it('arrangeDashboard lets an abort propagate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    await expect(arrangeDashboard([], new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fetchChartData returns live data', async () => {
    const data = { rows: [{ a: 1 }], columns: ['a'], truncated: false, ran_at: '2026-10-17T00:00:00+00:00' }
    mockApi({ '/api/charts/4/data': ok(data) })
    await expect(fetchChartData(4)).resolves.toEqual(data)
  })

  it('fetchChartData surfaces a 429 as ApiError with status 429', async () => {
    mockApi({ '/api/charts/4/data': fail(429, 'slow down') })
    await expect(fetchChartData(4)).rejects.toEqual(new ApiError('slow down', 429))
    await expect(fetchChartData(4)).rejects.toMatchObject({ status: 429 })
  })
})
