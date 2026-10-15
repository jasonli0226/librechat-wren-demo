import { vi } from 'vitest'

type Route = { readonly status?: number; readonly body: unknown } | { readonly raw: string; readonly status: number } | 'network-error'

export const ok = <T,>(data: T): Route => ({ body: { success: true, data, error: null } })
export const fail = (status: number, error: string): Route => ({ status, body: { success: false, data: null, error } })

export function mockApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)]
    if (route === undefined) throw new Error(`unmocked request: ${String(input)}`)
    if (route === 'network-error') throw new TypeError('Failed to fetch')
    if ('raw' in route) return new Response(route.raw, { status: route.status })
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
