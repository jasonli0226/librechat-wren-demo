import type { Spec } from '@json-render/core'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { useMemo } from 'react'
import { registry } from './registry'
import type { TileData } from './tileData'
import { TileContext } from './tiles'
import type { TilePlan } from './types'

interface Props {
  readonly spec: Spec
  readonly plans: readonly TilePlan[]
  readonly data: ReadonlyMap<number, TileData>
  readonly note: string | null
}

export function DashboardView({ spec, plans, data, note }: Props) {
  const tiles = useMemo(() => ({ plans: new Map(plans.map((p) => [p.chart.id, p])), data }), [plans, data])
  return (
    <TileContext.Provider value={tiles}>
      {note ? <p className="dashboard-note">{note}</p> : null}
      <JSONUIProvider registry={registry}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </TileContext.Provider>
  )
}
