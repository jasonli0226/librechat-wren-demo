import { expect, test, type Page } from '@playwright/test'
import { seedGallery } from './seeds'

const TILE_COMPONENT: Record<string, string> = {
  stat: 'StatTile',
  line: 'LineTile',
  bar: 'BarTile',
  scatter: 'ScatterTile',
  stackedBar: 'StackedBarTile',
  table: 'TableTile',
}
const INSIGHT = 'Central leads on store performance.'

interface RequestTile {
  chart_id: number
  type: string
}

/** A valid json-render JSONL spec: the first tile plus one insight in the Hero, the rest in one "Stores" section. */
function storesSpec(tiles: RequestTile[]): string {
  const [first, ...rest] = tiles
  const tile = (t: RequestTile, width: string) => ({
    op: 'add',
    path: `/elements/t${t.chart_id}`,
    value: { type: TILE_COMPONENT[t.type], props: { chartId: t.chart_id, width }, children: [] },
  })
  const lines: unknown[] = [
    { op: 'add', path: '/root', value: 'dash' },
    { op: 'add', path: '/elements/dash', value: { type: 'Dashboard', props: {}, children: rest.length ? ['hero', 'stores'] : ['hero'] } },
    { op: 'add', path: '/elements/hero', value: { type: 'Hero', props: {}, children: [`t${first.chart_id}`, 'ins'] } },
    { op: 'add', path: '/elements/ins', value: { type: 'Insights', props: { bullets: [INSIGHT] }, children: [] } },
    tile(first, 'full'),
    ...(rest.length
      ? [{ op: 'add', path: '/elements/stores', value: { type: 'Section', props: { title: 'Stores' }, children: rest.map((t) => `t${t.chart_id}`) } }]
      : []),
    ...rest.map((t) => tile(t, 'half')),
  ]
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

const stubArrange = (page: Page) =>
  page.route('**/api/dashboards/arrange', async (route) => {
    const { tiles } = route.request().postDataJSON() as { tiles: RequestTile[] }
    await route.fulfill({
      json: { success: true, data: { spec: storesSpec(tiles), headlines: {} }, error: null },
    })
  })

let ids: Map<string, number>

test.beforeAll(async ({ request }) => {
  ids = await seedGallery(request)
})

test('search builds a rules dashboard with snapshot tiles', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('searchbox').fill('store')
  await page.getByRole('link', { name: 'Build dashboard' }).click()

  await expect(page).toHaveURL(/\/dashboard\?/)
  // Wren is unreachable and there is no OpenRouter key: snapshot tiles, rules layout.
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByText('Revenue by store')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('Return rate by store')).toBeVisible()
  await expect(page.getByText('snapshot from')).toHaveCount(2)
  await expect(page.getByText('Arranged by rules')).toBeVisible()
})

test('AI arrangement puts the seed in the hero with insights and the rest in sections', async ({ page }) => {
  await stubArrange(page)

  await page.goto('/dashboard?q=store')

  await expect(page.getByRole('heading', { name: 'Stores' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('AI insights')).toBeVisible()
  await expect(page.getByText(INSIGHT)).toBeVisible()
  // The hero holds the first chart in the request; the other store chart is in the section.
  await expect(page.locator('.dashboard-hero .tile')).toHaveCount(1)
  await expect(page.locator('.dashboard-hero .tile-title')).toHaveText(/ by store$/)
  await expect(page.getByText('Arranged by rules')).toHaveCount(0)
})

test('on a phone the hero tile and insights each span the full row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubArrange(page)

  await page.goto(`/dashboard?from=${ids.get('Revenue by store')}`)

  const hero = page.locator('.dashboard-hero')
  const insights = hero.locator('.insights')
  await expect(insights).toBeVisible({ timeout: 90_000 })
  const heroBox = (await hero.boundingBox())!
  const insightsBox = (await insights.boundingBox())!
  const tileBox = (await hero.locator('.tile').first().boundingBox())!
  expect(insightsBox.width).toBeGreaterThan(heroBox.width - 2)
  expect(tileBox.width).toBeGreaterThan(heroBox.width - 2)
  // Stacked: the insights sit below the tile, not beside it.
  expect(insightsBox.y).toBeGreaterThanOrEqual(tileBox.y + tileBox.height - 1)
})

test('a scatter chart can be the hero', async ({ page }) => {
  await page.goto(`/dashboard?from=${ids.get('Basket size vs items')}`)

  await expect(page.locator('.dashboard-hero .recharts-scatter')).toBeVisible({ timeout: 90_000 })
})
