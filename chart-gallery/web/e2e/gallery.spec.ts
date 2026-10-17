import { expect, test } from '@playwright/test'
import { seedGallery } from './seeds'

test.beforeAll(async ({ request }) => {
  await seedGallery(request)
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
