import { useEffect, useRef, useState } from 'react'
import { fetchChartData, type LiveData } from '../api'
import { fittingTypes } from './tileTypes'
import type { Row, TilePlan, TileType } from './types'

export type TileData =
  | { status: 'loading' }
  | { status: 'live'; rows: readonly Row[] }
  | { status: 'snapshot'; rows: readonly Row[]; since: string }

const LOADING: TileData = { status: 'loading' }

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
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    for (const plan of plans) {
      const id = plan.chart.id
      if (requested.current.has(id)) continue
      requested.current.add(id)
      fetchChartData(id)
        .then((live) => resolveLiveRows(plan, live))
        .catch(() => snapshotOf(plan))
        .then((data) => {
          if (mounted.current) setResults((prev) => new Map(prev).set(id, data))
        })
    }
  }, [plans])

  return new Map(plans.map((p) => [p.chart.id, results.get(p.chart.id) ?? LOADING]))
}
