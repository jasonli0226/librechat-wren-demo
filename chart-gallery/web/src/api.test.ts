import { describe, expect, it } from 'vitest'
import { ApiError, fetchChart, fetchCharts } from './api'
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
})
