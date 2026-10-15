import { useSemanticStore } from 'semantic-state/react'
import { fetchChart, fetchCharts } from './api'
import type { ChartDetail, ChartSummary } from './types'
import { type RequestState, useRequest } from './useRequest'

/** Loads every chart summary and hands them to the semantic store before anything renders them. */
export function useChartList(): RequestState<ChartSummary[]> {
  const store = useSemanticStore<ChartSummary>()
  return useRequest(
    () =>
      fetchCharts().then((charts) => {
        store.upsert(charts)
        return charts
      }),
    [store],
  )
}

export function useChart(id: number): RequestState<ChartDetail> {
  return useRequest(() => fetchChart(id), [id])
}
