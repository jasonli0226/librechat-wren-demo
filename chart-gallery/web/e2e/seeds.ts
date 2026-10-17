import { type APIRequestContext, expect } from '@playwright/test'

const token = process.env.CHART_GALLERY_TOKEN ?? ''

export const SEEDS = [
  {
    title: 'Revenue by store',
    description: 'Completed-payment revenue for each physical store.',
    chart_type: 'bar',
    x_field: 'store_name',
    y_fields: ['revenue'],
    sql: 'SELECT s.store_name, SUM(o.total_amount) AS revenue FROM stores s JOIN orders o ON o.store_id = s.store_id GROUP BY 1 /* e2e seed */',
    rows: [{ store_name: 'Central', revenue: 1200.5 }, { store_name: 'Kowloon', revenue: 980 }],
  },
  {
    title: 'Return rate by store',
    description: 'Share of orders returned at each physical store.',
    chart_type: 'bar',
    x_field: 'store_name',
    y_fields: ['return_rate'],
    sql: 'SELECT s.store_name, COUNT(r.return_id)::numeric / COUNT(o.order_id) AS return_rate FROM stores s JOIN orders o ON o.store_id = s.store_id LEFT JOIN returns r ON r.order_id = o.order_id GROUP BY 1 /* e2e seed */',
    rows: [{ store_name: 'Central', return_rate: 0.04 }, { store_name: 'Kowloon', return_rate: 0.07 }],
  },
  {
    title: 'Customers by loyalty tier',
    description: 'How many customers sit in each loyalty tier.',
    chart_type: 'pie',
    x_field: 'loyalty_tier',
    y_fields: ['customers'],
    sql: 'SELECT loyalty_tier, COUNT(*) AS customers FROM customers GROUP BY 1 /* e2e seed */',
    rows: [{ loyalty_tier: 'gold', customers: 120 }, { loyalty_tier: 'silver', customers: 300 }],
  },
  {
    title: 'Basket size vs items',
    description: 'Average basket value against average items per order, one point per store.',
    chart_type: 'scatter',
    x_field: 'avg_items',
    y_fields: ['avg_basket'],
    sql: 'SELECT s.store_name, AVG(i.items) AS avg_items, AVG(o.total_amount) AS avg_basket FROM stores s JOIN orders o ON o.store_id = s.store_id JOIN (SELECT order_id, COUNT(*) AS items FROM order_items GROUP BY 1) i ON i.order_id = o.order_id GROUP BY 1 /* e2e seed */',
    rows: [
      { avg_items: 1.8, avg_basket: 42.5 },
      { avg_items: 2.4, avg_basket: 58 },
      { avg_items: 3.1, avg_basket: 77.25 },
      { avg_items: 3.9, avg_basket: 95 },
      { avg_items: 4.6, avg_basket: 118.4 },
    ],
  },
]

/**
 * Seeds the throwaway gallery and returns each seed's chart id by title. Idempotent, so every spec
 * file can call it: the gallery dedups seeds by SQL, and one holding any non-seed chart is refused.
 */
export async function seedGallery(request: APIRequestContext): Promise<Map<string, number>> {
  expect(token.length, 'CHART_GALLERY_TOKEN must be set').toBeGreaterThanOrEqual(32)
  // The seeds carry made-up numbers: only ever write them into a fresh, throwaway gallery.
  const existing = await (await request.get('/api/charts')).json()
  const seedTitles = new Set(SEEDS.map((s) => s.title))
  const foreign = (existing.data as { title: string }[]).filter((c) => !seedTitles.has(c.title))
  expect(foreign, 'refusing to seed made-up charts into a gallery that already has other charts').toEqual([])
  for (const seed of SEEDS) {
    const response = await request.post('/internal/charts', { data: seed, headers: { Authorization: `Bearer ${token}` } })
    expect(response.ok()).toBeTruthy()
  }
  const all = await (await request.get('/api/charts')).json()
  return new Map((all.data as { id: number; title: string }[]).map((c) => [c.title, c.id]))
}
