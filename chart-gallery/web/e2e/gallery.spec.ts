import { expect, test } from '@playwright/test'

const token = process.env.CHART_GALLERY_TOKEN ?? ''

const SEEDS = [
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
]

test.beforeAll(async ({ request }) => {
  expect(token.length, 'set CHART_GALLERY_TOKEN from .env').toBeGreaterThanOrEqual(32)
  for (const seed of SEEDS) {
    const response = await request.post('/internal/charts', { data: seed, headers: { Authorization: `Bearer ${token}` } })
    expect(response.ok()).toBeTruthy()
  }
})

test('list → detail → related charts, with no CDN traffic', async ({ page, context }) => {
  const external: string[] = []
  await context.route(/huggingface\.co|cdn\.jsdelivr\.net|unpkg\.com/, (route) => {
    external.push(route.request().url())
    return route.abort()
  })

  await page.goto('/')
  await page.getByRole('searchbox').fill('return rate')
  await page.getByRole('link', { name: /Return rate by store/ }).first().click()

  await expect(page.getByRole('heading', { level: 1, name: 'Return rate by store' })).toBeVisible()
  await expect(page.locator('.chart-frame svg.recharts-surface')).toBeVisible()

  const related = page.locator('section.related')
  await expect(related).toHaveAttribute('data-model-status', 'ready', { timeout: 90_000 })
  await expect(related.getByText('refining…')).toHaveCount(0)
  await expect(related).toContainText('Revenue by store')
  await expect(related).toContainText('similar topic')
  expect(external).toEqual([])
})

test('unknown chart shows not found', async ({ page }) => {
  await page.goto('/charts/999999999')
  await expect(page.getByRole('heading', { name: 'Chart not found' })).toBeVisible()
})
