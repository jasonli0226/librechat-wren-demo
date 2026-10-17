import type { Spec } from '@json-render/core'
import { render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ChartDetail } from '../types'
import { DashboardView } from './DashboardView'
import { buildRulesSpec, tileKey } from './rulesLayout'
import type { TileData } from './tileData'
import type { Row, TilePlan, TileType } from './types'

// jsdom has no layout, so give every ResponsiveContainer chart a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 300 }),
  }
})

const SINCE = new Date(Date.now() - 3 * 86_400_000).toISOString()
const STORE_ROWS: Row[] = [
  { store: 'Central', revenue: 5 },
  { store: 'Kowloon', revenue: 9 },
]

function plan(id: number, type: TileType, rows: Row[] = STORE_ROWS, confidence: number | null = null): TilePlan {
  const chart = {
    id,
    title: `Chart ${id}`,
    description: '',
    chart_type: 'bar',
    tables: [`t${id}`],
    updated_at: SINCE,
    x_field: 'store',
    y_fields: ['revenue'],
    sql: '',
    rows,
    created_at: SINCE,
  } as ChartDetail
  return { chart, type, allowed: [type, 'table'], confidence }
}

const snapshot = (p: TilePlan): TileData => ({ status: 'snapshot', rows: p.chart.rows, since: SINCE })
const live = (p: TilePlan): TileData => ({ status: 'live', rows: p.chart.rows })
const allLive = (plans: TilePlan[]) => new Map(plans.map((p) => [p.chart.id, live(p)]))

function draw(plans: TilePlan[], data: Map<number, TileData>, spec: Spec = buildRulesSpec(plans), note: string | null = null) {
  return render(<DashboardView spec={spec} plans={plans} data={data} note={note} />)
}

const tileOf = (title: string) => screen.getByText(title).closest('.tile') as HTMLElement

describe('DashboardView', () => {
  it('renders a rules spec with every tile title in plan order', () => {
    const plans = [plan(1, 'stat', [{ store: 'All', revenue: 42 }]), plan(2, 'bar'), plan(3, 'table')]
    draw(plans, allLive(plans), undefined, 'Arranged by rules')
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Chart 1', 'Chart 2', 'Chart 3'])
    expect(screen.getByText('Arranged by rules')).toBeInTheDocument()
    expect(within(tileOf('Chart 1')).getByText('42')).toBeInTheDocument()
    expect(tileOf('Chart 2').querySelector('.recharts-bar')).not.toBeNull()
    expect(within(tileOf('Chart 3')).getByRole('table')).toBeInTheDocument()
  })

  it('shows a skeleton while loading and the snapshot note on fallback', () => {
    const plans = [plan(1, 'bar'), plan(2, 'bar')]
    draw(plans, new Map<number, TileData>([[1, { status: 'loading' }], [2, snapshot(plans[1])]]))
    expect(tileOf('Chart 1').querySelector('.tile-skeleton')).not.toBeNull()
    expect(within(tileOf('Chart 2')).getByText('snapshot from 3 days ago')).toBeInTheDocument()
    expect(tileOf('Chart 2').querySelector('.tile-skeleton')).toBeNull()
  })

  it('a stat without a numeric value shows —', () => {
    const plans = [plan(1, 'stat', [{ store: 'All', revenue: null }])]
    draw(plans, new Map([[1, snapshot(plans[0])]]))
    expect(within(tileOf('Chart 1')).getByText('—')).toBeInTheDocument()
  })

  it('shows confidence when known and sorts table rows by the first y, descending', () => {
    const rows = [{ store: 'A', revenue: 1 }, { store: 'B', revenue: null }, { store: 'C', revenue: 7 }]
    const plans = [plan(1, 'table', rows, 0.7234), plan(2, 'table')]
    draw(plans, allLive(plans))
    const confidence = within(tileOf('Chart 1')).getByText('0.72')
    expect(confidence).toHaveAttribute('aria-hidden', 'true')
    expect(confidence.getAttribute('title')).toContain('0.72')
    expect(tileOf('Chart 2').querySelector('.tile-confidence')).toBeNull()
    const firstCells = within(tileOf('Chart 1'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.firstElementChild?.textContent)
    expect(firstCells).toEqual(['C', 'A', 'B'])
    expect(rows.map((r) => r.store)).toEqual(['A', 'B', 'C'])
  })

  it('draws a stacked bar with one segment per row and a legend', () => {
    const rows = [{ store: 'A', revenue: 2 }, { store: 'B', revenue: 3 }, { store: 'C', revenue: 1 }]
    const plans = [plan(1, 'stackedBar', rows)]
    draw(plans, new Map([[1, snapshot(plans[0])]]))
    const tile = tileOf('Chart 1')
    expect(tile.querySelectorAll('.recharts-bar')).toHaveLength(3)
    expect(tile.querySelector('.recharts-legend-wrapper')).not.toBeNull()
  })

  it('renders AI insights beside the hero', () => {
    const plans = [plan(1, 'bar'), plan(2, 'table'), plan(3, 'bar')]
    const bullets = ['Kowloon leads revenue.', 'Central trails.']
    const spec: Spec = {
      root: 'dashboard',
      elements: {
        dashboard: { type: 'Dashboard', props: {}, children: ['hero', 's1', 's2'] },
        hero: { type: 'Hero', props: {}, children: [tileKey(1), 'insights'] },
        insights: { type: 'Insights', props: { bullets }, children: [] },
        s1: { type: 'Section', props: { title: 'Revenue' }, children: [tileKey(2)] },
        s2: { type: 'Section', props: { title: 'Detail' }, children: [tileKey(3)] },
        [tileKey(1)]: { type: 'BarTile', props: { chartId: 1, width: 'full' }, children: [] },
        [tileKey(2)]: { type: 'TableTile', props: { chartId: 2, width: 'full' }, children: [] },
        [tileKey(3)]: { type: 'BarTile', props: { chartId: 3, width: 'half' }, children: [] },
      },
    }
    const { container } = draw(plans, allLive(plans), spec)
    const hero = container.querySelector('.dashboard-hero') as HTMLElement
    expect(hero).not.toBeNull()
    expect(within(hero).getByText('AI insights')).toBeInTheDocument()
    for (const bullet of bullets) expect(within(hero).getByText(bullet)).toBeInTheDocument()
    expect(within(hero).getByText('Chart 1')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Revenue', 'Detail'])
  })

  it('puts the first plan in the hero and omits insights and section headings in the rules spec', () => {
    const plans = [plan(1, 'bar'), plan(2, 'bar')]
    const { container } = draw(plans, allLive(plans))
    const hero = container.querySelector('.dashboard-hero') as HTMLElement
    expect(within(hero).getByText('Chart 1')).toBeInTheDocument()
    expect(within(hero).queryByText('Chart 2')).toBeNull()
    expect(screen.queryByText('AI insights')).toBeNull()
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
  })

  it('each tile has a view-transition-name from its chart id', () => {
    const plans = [plan(9, 'line'), plan(1, 'stat', [{ store: 'All', revenue: 3 }]), plan(7, 'bar')]
    draw(plans, new Map(plans.map((p) => [p.chart.id, snapshot(p)])))
    for (const p of plans) {
      expect(tileOf(p.chart.title).style.viewTransitionName).toBe(tileKey(p.chart.id))
    }
    expect(tileOf('Chart 1').style.gridColumn).toBe('span 3')
    expect(tileOf('Chart 9').style.gridColumn).toBe('span 12')
  })

  it('draws a pair-mode scatter tile, and shows a table when live rows stop fitting', () => {
    const pairRows: Row[] = Array.from({ length: 6 }, (_, i) => ({ store: `s${i}`, revenue: i + 1, orders: i * 2 }))
    const scatter = plan(1, 'scatter', pairRows)
    scatter.chart = { ...scatter.chart, y_fields: ['revenue', 'orders'] }
    const { unmount } = draw([scatter], allLive([scatter]))
    expect(tileOf('Chart 1').querySelector('.recharts-scatter')).not.toBeNull()
    unmount()

    const fewRows = pairRows.slice(0, 2)
    draw([scatter], new Map<number, TileData>([[1, { status: 'live', rows: fewRows }]]))
    expect(within(tileOf('Chart 1')).getByRole('table')).toBeInTheDocument()
    expect(tileOf('Chart 1').querySelector('.recharts-scatter')).toBeNull()
  })
})
