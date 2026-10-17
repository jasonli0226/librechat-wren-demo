import type { Spec } from '@json-render/core'
import { sharedTables } from '../semantic/features'
import { TILE_COMPONENT } from './catalog'
import type { TilePlan, TileWidth } from './types'

type Element = Spec['elements'][string]
type Placed = [TilePlan, TileWidth]

export const tileKey = (chartId: number): string => `tile-${chartId}`

/** Greedy clustering: take the first remaining plan, then every remaining plan sharing a table with it. */
export function orderTiles(plans: readonly TilePlan[]): TilePlan[] {
  const remaining = [...plans]
  const ordered: TilePlan[] = []
  while (remaining.length > 0) {
    const seed = remaining.shift() as TilePlan
    ordered.push(seed)
    for (let i = 0; i < remaining.length; ) {
      if (sharedTables(seed.chart, remaining[i].chart).length > 0) ordered.push(...remaining.splice(i, 1))
      else i++
    }
  }
  return ordered
}

/** Gap-free widths: lines are full, other tiles pair up as halves, a lone leftover is full. */
function widen(plans: readonly TilePlan[]): Placed[] {
  const out: Placed[] = []
  const full = (list: readonly TilePlan[]): Placed[] => list.map((p) => [p, 'full'])
  let held: TilePlan | null = null
  let heldLines: TilePlan[] = []
  for (const plan of plans) {
    if (plan.type === 'line') {
      if (held) heldLines.push(plan)
      else out.push(...full([plan]))
    } else if (held) {
      out.push([held, 'half'], [plan, 'half'], ...full(heldLines))
      held = null
      heldLines = []
    } else {
      held = plan
    }
  }
  if (held) out.push(...full([held]))
  out.push(...full(heldLines))
  return out
}

export function buildRulesSpec(plans: readonly TilePlan[]): Spec {
  const stats: Placed[] = plans.filter((p) => p.type === 'stat').map((p) => [p, 'quarter'])
  const rest = orderTiles(plans.filter((p) => p.type !== 'stat'))
  const laidOut = [...stats, ...widen(rest)]

  const elements: Record<string, Element> = {
    dashboard: { type: 'Dashboard', props: { summary: '' }, children: ['section-1'] },
    'section-1': { type: 'Section', props: { title: '' }, children: laidOut.map(([p]) => tileKey(p.chart.id)) },
  }
  for (const [plan, width] of laidOut) {
    elements[tileKey(plan.chart.id)] = {
      type: TILE_COMPONENT[plan.type],
      props: { chartId: plan.chart.id, width },
      children: [],
    }
  }
  return { root: 'dashboard', elements }
}
