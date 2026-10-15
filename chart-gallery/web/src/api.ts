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

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path)
  } catch {
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

export const fetchCharts = () => getJson<ChartSummary[]>('/api/charts')
export const fetchChart = (id: number) => getJson<ChartDetail>(`/api/charts/${id}`)
