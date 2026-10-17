import { expect, test } from '@playwright/test'
import { seedGallery } from './seeds'

const TILE_COMPONENT: Record<string, string> = {
  stat: 'StatTile',
  line: 'LineTile',
  bar: 'BarTile',
  stackedBar: 'StackedBarTile',
  table: 'TableTile',
}
const SUMMARY = 'Store performance at a glance.'

interface RequestTile {
  chart_id: number
  type: string
}

/** A valid json-render JSONL spec that puts every requested tile into one "Stores" section. */
function storesSpec(tiles: RequestTile[]): string {
  const lines: unknown[] = [
    { op: 'add', path: '/root', value: 'dash' },
    { op: 'add', path: '/elements/dash', value: { type: 'Dashboard', props: { summary: SUMMARY }, children: ['stores'] } },
    { op: 'add', path: '/elements/stores', value: { type: 'Section', props: { title: 'Stores' }, children: tiles.map((t) => `t${t.chart_id}`) } },
    ...tiles.map((t) => ({
      op: 'add',
      path: `/elements/t${t.chart_id}`,
      value: { type: TILE_COMPONENT[t.type], props: { chartId: t.chart_id, width: 'half' }, children: [] },
    })),
  ]
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

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

test('AI arrangement moves tiles into sections', async ({ page }) => {
  await page.route('**/api/dashboards/arrange', async (route) => {
    const { tiles } = route.request().postDataJSON() as { tiles: RequestTile[] }
    await route.fulfill({
      json: { success: true, data: { spec: storesSpec(tiles), headlines: {} }, error: null },
    })
  })

  await page.goto(`/dashboard?from=${ids.get('Revenue by store')}`)

  await expect(page.getByRole('heading', { name: 'Stores' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('AI summary')).toBeVisible()
  await expect(page.getByText(SUMMARY)).toBeVisible()
  await expect(page.getByText('Arranged by rules')).toHaveCount(0)
})
