import type { Spec } from '@json-render/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { similarKey, type QueryResult, type ResultRow } from 'semantic-state'
import { SemanticProvider } from 'semantic-state/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../App'
import { tileKey } from '../dashboard/rulesLayout'
import { createFakeStore } from '../test/fakeStore'
import { SUMMARIES } from '../test/fixtures'
import { fail, mockApi, ok } from '../test/mockApi'
import { renderApp } from '../test/renderApp'
import type { ChartDetail, ChartSummary } from '../types'
// Loaded up front so the lazy route resolves without waiting on module loading.
import './DashboardPage'

// jsdom has no layout, so give every ResponsiveContainer chart a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 300 }),
  }
})

const TITLES = Object.fromEntries(SUMMARIES.map((c) => [c.id, c.title])) as Record<number, string>
const ARRANGE = 'POST /api/dashboards/arrange'
const LOADING_MODEL = { model: { status: 'loading' as const, progress: 0.3, error: null } }

const detail = (summary: ChartSummary): ChartDetail => ({
  ...summary,
  x_field: 'store',
  y_fields: ['value'],
  sql: 'SELECT 1',
  rows: [
    { store: 'Central', value: 5 },
    { store: 'Kowloon', value: 9 },
  ],
  created_at: summary.updated_at,
})

const neighbour = (id: number, confidence: number): ResultRow<ChartSummary> => ({
  id,
  item: SUMMARIES[id - 1],
  score: confidence,
  confidence,
  reason: { kind: 'interest', becauseOf: 2 },
})

const queryResult = (ranked: ResultRow<ChartSummary>[]): QueryResult<ChartSummary> => ({
  ranked,
  extras: [],
  interests: [],
  rankMs: 1,
  itemCount: SUMMARIES.length,
  updatedAt: 0,
  networkRequests: null,
})

/** A valid AI arrangement placing every chart as a table in one titled section. */
function aiSpec(ids: number[], title = 'Store performance'): Spec {
  const elements: Spec['elements'] = {
    dashboard: { type: 'Dashboard', props: { summary: '' }, children: ['s1'] },
    s1: { type: 'Section', props: { title }, children: ids.map(tileKey) },
  }
  for (const id of ids) elements[tileKey(id)] = { type: 'TableTile', props: { chartId: id, width: 'full' }, children: [] }
  return { root: 'dashboard', elements }
}

function toJsonl(spec: Spec): string {
  const lines: object[] = [{ op: 'add', path: '/root', value: spec.root }]
  for (const [key, value] of Object.entries(spec.elements)) lines.push({ op: 'add', path: `/elements/${key}`, value })
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

const arrangeOk = (ids: number[], title?: string) => ok({ spec: toJsonl(aiSpec(ids, title)), headlines: {} })

function chartRoutes() {
  return {
    '/api/charts': ok(SUMMARIES),
    ...Object.fromEntries(SUMMARIES.map((c) => [`/api/charts/${c.id}`, ok(detail(c))])),
    ...Object.fromEntries(SUMMARIES.map((c) => [`/api/charts/${c.id}/data`, fail(503, 'wren down')])),
  }
}

const arrangeCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/dashboards/arrange' && init?.method === 'POST')

const tileTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)

/** Advances fake time and lets the resulting promises and renders settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardPage', () => {
  it('builds a rules dashboard then swaps to the AI arrangement', async () => {
    const fetchMock = mockApi({ ...chartRoutes(), [ARRANGE]: arrangeOk([2, 1, 3]) })
    const { store } = createFakeStore({ similar: { [similarKey(2, 5)]: [neighbour(1, 0.8), neighbour(3, 0.6)] } })
    renderApp('/dashboard?from=2', store)

    expect(await screen.findByRole('heading', { level: 2, name: 'Store performance' })).toBeInTheDocument()
    expect(screen.queryByText('Arranged by rules')).toBeNull()
    expect(tileTitles()).toEqual([TITLES[2], TITLES[1], TITLES[3]])
    expect(store.requestSimilar).toHaveBeenCalledWith(2, 5)
    const calls = arrangeCalls(fetchMock)
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0][1]?.body)) as { tiles: { chart_id: number }[] }
    expect(body.tiles.map((t) => t.chart_id)).toEqual([2, 1, 3])
  })

  it('keeps the rules layout when the AI call fails', async () => {
    mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store } = createFakeStore({ similar: { [similarKey(2, 5)]: [neighbour(1, 0.8), neighbour(3, 0.6)] } })
    renderApp('/dashboard?from=2', store)

    expect(await screen.findByText('Arranged by rules')).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect([...tileTitles()].sort()).toEqual([TITLES[1], TITLES[2], TITLES[3]].sort())
  })

  it('falls back to table-overlap ranking after 1.5 s without the model', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store } = createFakeStore(LOADING_MODEL)
    renderApp('/dashboard?from=2', store)

    await advance(1400)
    expect(screen.getByText('Finding related charts…')).toBeInTheDocument()
    expect(tileTitles()).toEqual([])

    await advance(200)
    // Chart 1 shares the "stores" table with the seed; chart 3 shares nothing.
    expect(tileTitles()).toEqual([TITLES[2], TITLES[1]])
    expect(screen.queryByText('Finding related charts…')).toBeNull()
  })

  it('does not change the selection when the model becomes ready later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetchMock = mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store, update } = createFakeStore(LOADING_MODEL)
    renderApp('/dashboard?from=2', store)
    await advance(1600)
    expect(tileTitles()).toEqual([TITLES[2], TITLES[1]])

    await act(async () => {
      update({ model: { status: 'ready', progress: 1, error: null }, similar: { [similarKey(2, 5)]: [neighbour(3, 0.9)] } })
    })
    await advance(100)

    expect(tileTitles()).toEqual([TITLES[2], TITLES[1]])
    expect(arrangeCalls(fetchMock)).toHaveLength(1)
  })

  it('unknown from id shows a message with a link back', async () => {
    mockApi(chartRoutes())
    renderApp('/dashboard?from=9')
    expect(await screen.findByText('Chart 9 was not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the gallery/i })).toHaveAttribute('href', '/')
  })

  it('a query with no matches shows a message', async () => {
    mockApi(chartRoutes())
    const { store } = createFakeStore({ results: { zzz: queryResult([]) } })
    renderApp('/dashboard?q=zzz', store)
    // An empty ranking is not trusted until the model wait ends; then the substring filter finds nothing either.
    expect(await screen.findByText('No charts match “zzz”.', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the gallery/i })).toHaveAttribute('href', '/')
  })

  it('missing source shows a link back to the gallery', async () => {
    mockApi(chartRoutes())
    renderApp('/dashboard')
    expect(await screen.findByText(/Pick a chart or search the gallery/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the gallery/i })).toHaveAttribute('href', '/')
  })

  it('an AI result arriving after the 8 s timeout is ignored', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const respond = mockApi({ ...chartRoutes(), [ARRANGE]: arrangeOk([2, 1, 3]) })
    const late = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/dashboards/arrange') await new Promise((resolve) => setTimeout(resolve, 8100))
      return respond(input, init)
    })
    vi.stubGlobal('fetch', late)
    const { store } = createFakeStore({ similar: { [similarKey(2, 5)]: [neighbour(1, 0.8), neighbour(3, 0.6)] } })
    renderApp('/dashboard?from=2', store)

    await advance(100)
    expect(tileTitles()).toHaveLength(3)
    expect(screen.queryByText('Arranged by rules')).toBeNull()

    await advance(8000)
    expect(screen.getByText('Arranged by rules')).toBeInTheDocument()
    await advance(200)
    expect(respond).toHaveBeenCalledWith('/api/dashboards/arrange', expect.anything())
    expect(screen.queryByRole('heading', { level: 2, name: 'Store performance' })).toBeNull()
    expect(screen.getByText('Arranged by rules')).toBeInTheDocument()
  })

  it('shows the shell and Finding related charts… while selecting', async () => {
    mockApi(chartRoutes())
    const { store } = createFakeStore(LOADING_MODEL)
    renderApp('/dashboard?q=loyalty', store)
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Finding related charts…')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Min score' })).toHaveValue(0.3)
    expect(screen.getByRole('spinbutton', { name: 'Max tiles' })).toHaveValue(6)
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeInTheDocument()
  })

  it('shows a hint to lower Min score when nothing passes it', async () => {
    mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store } = createFakeStore({ similar: { [similarKey(2, 5)]: [neighbour(1, 0.2)] } })
    renderApp('/dashboard?from=2', store)
    expect(await screen.findByText('Lower Min score to see more charts.')).toBeInTheDocument()
    expect(tileTitles()).toEqual([TITLES[2]])
  })

  it('hides the Min score hint when the ranking had no other candidates', async () => {
    mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store } = createFakeStore({ similar: { [similarKey(2, 5)]: [] } })
    renderApp('/dashboard?from=2', store)
    expect(await screen.findByText('Arranged by rules')).toBeInTheDocument()
    expect(tileTitles()).toEqual([TITLES[2]])
    expect(screen.queryByText('Lower Min score to see more charts.')).toBeNull()
  })

  it('Rebuild writes min and max to the URL and rebuilds', async () => {
    const fetchMock = mockApi({ ...chartRoutes(), [ARRANGE]: fail(503, 'model unavailable') })
    const { store } = createFakeStore({
      similar: {
        [similarKey(2, 5)]: [neighbour(1, 0.8), neighbour(3, 0.6)],
        [similarKey(2, 1)]: [neighbour(1, 0.8)],
      },
    })
    render(
      <SemanticProvider store={store}>
        <MemoryRouter initialEntries={['/dashboard?from=2']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </SemanticProvider>,
    )
    expect(await screen.findByText('Arranged by rules')).toBeInTheDocument()
    expect(tileTitles()).toHaveLength(3)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Min score' }), { target: { value: '0.7' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Max tiles' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))

    const params = new URLSearchParams(screen.getByTestId('location').textContent ?? '')
    expect(Object.fromEntries(params)).toEqual({ from: '2', min: '0.7', max: '2' })
    expect(await screen.findByText(TITLES[1])).toBeInTheDocument()
    await vi.waitFor(() => expect(tileTitles()).toEqual([TITLES[2], TITLES[1]]))
    expect(store.requestSimilar).toHaveBeenCalledWith(2, 1)
    await vi.waitFor(() => expect(arrangeCalls(fetchMock)).toHaveLength(2))
    expect(within(document.body).getByText('Arranged by rules')).toBeInTheDocument()
  })
})
