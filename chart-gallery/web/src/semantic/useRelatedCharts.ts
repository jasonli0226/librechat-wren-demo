import { useMemo } from 'react'
import type { ModelState, ResultRow } from 'semantic-state'
import { useSemanticSnapshot, useSimilar } from 'semantic-state/react'
import type { ChartSummary } from '../types'
import { RELATED_COUNT, rankByTables } from './features'

export interface RelatedState {
  readonly rows: readonly ResultRow<ChartSummary>[]
  readonly refining: boolean
  readonly modelStatus: ModelState['status']
}

/**
 * Neighbours of one chart. The worker handles messages in order, so the `similar` request waits
 * behind the list's upsert and is answered once embedding finished (text + tables) or failed
 * (tables only). Until then, show a table-overlap ranking computed here.
 */
export function useRelatedCharts(
  current: ChartSummary,
  charts: readonly ChartSummary[],
  k = RELATED_COUNT,
): RelatedState {
  const snapshot = useSemanticSnapshot<ChartSummary>()
  const answered = useSimilar<ChartSummary>(current.id, k)
  const fallback = useMemo(() => rankByTables(current, charts, k), [current, charts, k])
  return {
    rows: answered ?? fallback,
    refining: answered === null,
    modelStatus: snapshot.model.status,
  }
}
