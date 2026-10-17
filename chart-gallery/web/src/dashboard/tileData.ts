import { useEffect, useRef, useState } from 'react'
import { fetchChartData, type LiveData } from '../api'
import { fittingTypes } from './tileTypes'
import type { Row, TilePlan, TileType } from './types'

export type TileData =
  | { status: 'loading' }
  | { status: 'live'; rows: readonly Row[] }
  | { status: 'snapshot'; rows: readonly Row[]; since: string }

const LOADING: TileData = { status: 'loading' }
// A hung Wren would leave tiles as skeletons; past this the tile shows its snapshot instead.
export const TILE_DATA_TIMEOUT_MS = 3000

interface Pending {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
}

function snapshotOf(plan: TilePlan): TileData {
  return { status: 'snapshot', rows: plan.chart.rows, since: plan.chart.updated_at }
}

// Live rows only replace the snapshot when they still carry the columns the tile reads.
export function resolveLiveRows(plan: TilePlan, live: LiveData): TileData {
  const { x_field, y_fields } = plan.chart
  const usable =
    live.rows.length > 0 && live.rows.every((r) => x_field in r && y_fields.every((f) => f in r))
  return usable ? { status: 'live', rows: live.rows } : snapshotOf(plan)
}

export function effectiveType(plan: TilePlan, data: TileData): TileType {
  if (data.status !== 'live') return plan.type
  return fittingTypes(plan.chart, data.rows).includes(plan.type) ? plan.type : 'table'
}

export function useTileData(plans: readonly TilePlan[]): ReadonlyMap<number, TileData> {
  const [results, setResults] = useState<ReadonlyMap<number, TileData>>(new Map())
  const requested = useRef(new Set<number>())
  const pending = useRef(new Map<number, Pending>())

  useEffect(() => {
    const inFlight = pending.current
    const ids = requested.current
    return () => {
      // Unfinished requests are forgotten so a remount (StrictMode) asks again.
      for (const [id, { controller, timer }] of inFlight) {
        clearTimeout(timer)
        controller.abort()
        ids.delete(id)
      }
      inFlight.clear()
    }
  }, [])

  useEffect(() => {
    for (const plan of plans) {
      const id = plan.chart.id
      if (requested.current.has(id)) continue
      requested.current.add(id)
      const controller = new AbortController()
      const settle = (data: TileData) => {
        const entry = pending.current.get(id)
        if (entry?.controller !== controller) return
        clearTimeout(entry.timer)
        pending.current.delete(id)
        setResults((prev) => new Map(prev).set(id, data))
      }
      const timer = setTimeout(() => {
        settle(snapshotOf(plan))
        controller.abort()
      }, TILE_DATA_TIMEOUT_MS)
      pending.current.set(id, { controller, timer })
      fetchChartData(id, controller.signal)
        .then((live) => resolveLiveRows(plan, live))
        .catch(() => snapshotOf(plan))
        .then(settle)
    }
  }, [plans])

  return new Map(plans.map((p) => [p.chart.id, results.get(p.chart.id) ?? LOADING]))
}
