import type { Spec } from '@json-render/core'
import { TILE_COMPONENT } from './catalog'
import type { TilePlan, TileWidth } from './types'

type Element = Spec['elements'][string]
type Placed = [TilePlan, TileWidth]

export const HERO_KEY = 'hero'
const ROOT_KEY = 'dashboard'
const SECTION_KEY = 'section-1'

export const tileKey = (chartId: number): string => `tile-${chartId}`

/** Gap-free widths in input order: tiles pair up as halves, a lone leftover is full. */
function widen(plans: readonly TilePlan[]): Placed[] {
  return plans.map((plan, i) => {
    const paired = i % 2 === 1 || i + 1 < plans.length
    return [plan, paired ? 'half' : 'full']
  })
}

const tileElement = ([plan, width]: Placed): Element => ({
  type: TILE_COMPONENT[plan.type],
  props: { chartId: plan.chart.id, width },
  children: [],
})

/** Hero row with plans[0], then one untitled section: the other stats as quarters, the rest in score order. */
export function buildRulesSpec(plans: readonly TilePlan[]): Spec {
  const [main, ...others] = plans
  if (!main) throw new Error('buildRulesSpec needs at least one plan')
  const stats: Placed[] = others.filter((p) => p.type === 'stat').map((p) => [p, 'quarter'])
  const supporting = [...stats, ...widen(others.filter((p) => p.type !== 'stat'))]
  const hero: Placed = [main, 'full']

  const elements: Record<string, Element> = {
    [ROOT_KEY]: { type: 'Dashboard', props: {}, children: supporting.length > 0 ? [HERO_KEY, SECTION_KEY] : [HERO_KEY] },
    [HERO_KEY]: { type: 'Hero', props: {}, children: [tileKey(main.chart.id)] },
  }
  if (supporting.length > 0) {
    elements[SECTION_KEY] = { type: 'Section', props: { title: '' }, children: supporting.map(([p]) => tileKey(p.chart.id)) }
  }
  for (const placed of [hero, ...supporting]) elements[tileKey(placed[0].chart.id)] = tileElement(placed)
  return { root: ROOT_KEY, elements }
}
