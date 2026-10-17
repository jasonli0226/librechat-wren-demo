import type { Headlines, Row, TileType } from './dashboard/types'
import type { ChartDetail, ChartSummary } from './types'

interface Envelope<T> {
  readonly success: boolean
  readonly data: T | null
  readonly error: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Chart gallery API is unreachable', 0)
  }
  let body: Envelope<T> | null = null
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    body = null
  }
  if (!response.ok || !body?.success || body.data === null) {
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }
  return body.data
}

const getJson = <T>(path: string) => requestJson<T>(path)

export interface LiveData {
  rows: Row[]
  columns: string[]
  truncated: boolean
  ran_at: string
}

export interface ArrangeTile {
  chart_id: number
  type: TileType
  allowed_types: TileType[]
}

export const fetchChartData = (id: number, signal?: AbortSignal) =>
  requestJson<LiveData>(`/api/charts/${id}/data`, { signal })

export const arrangeDashboard = (tiles: ArrangeTile[], signal?: AbortSignal) =>
  requestJson<{ spec: string; headlines: Headlines }>('/api/dashboards/arrange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tiles }),
    signal,
  })

export const fetchCharts =() => getJson<ChartSummary[]>('/api/charts')
export const fetchChart = (id: number) => getJson<ChartDetail>(`/api/charts/${id}`)
