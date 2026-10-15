import type { ChartSummary } from './types'

export function filterCharts(charts: readonly ChartSummary[], query: string): ChartSummary[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...charts]
  return charts.filter((chart) => `${chart.title}\n${chart.description}`.toLowerCase().includes(needle))
}
