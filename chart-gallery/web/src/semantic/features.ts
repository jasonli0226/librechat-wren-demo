import type { FeatureVectors, Id, ResultRow } from 'semantic-state'
import type { ChartSummary } from '../types'
import model from './model.json'

/** Weight of shared warehouse tables relative to the title+description embedding (weight 1). */
export const TABLE_WEIGHT = 0.15
export const RELATED_COUNT = 3
export const EMBED_MODEL: string = model.id

export const chartText = (chart: ChartSummary) => `${chart.title}. ${chart.description}`

/** One-hot, unit-length vector of each chart's tables over every table name in the set. */
export function tableFeatures(items: readonly ChartSummary[]): ReadonlyMap<Id, FeatureVectors> {
  const vocabulary = [...new Set(items.flatMap((chart) => chart.tables))].sort()
  const position = new Map(vocabulary.map((table, i) => [table, i]))
  const out = new Map<Id, FeatureVectors>()
  for (const chart of items) {
    if (chart.tables.length === 0) continue
    const vector = new Float32Array(vocabulary.length)
    const weight = 1 / Math.sqrt(chart.tables.length)
    for (const table of chart.tables) vector[position.get(table)!] = weight
    out.set(chart.id, { tables: vector })
  }
  return out
}

export function sharedTables(current: ChartSummary, other: ChartSummary): string[] {
  const mine = new Set(current.tables)
  return other.tables.filter((table) => mine.has(table))
}

/** Main-thread stand-in while the worker is still embedding: table overlap (cosine of the one-hot vectors). */
export function rankByTables(current: ChartSummary, charts: readonly ChartSummary[], k: number): ResultRow<ChartSummary>[] {
  if (current.tables.length === 0) return []
  return charts
    .filter((chart) => chart.id !== current.id && chart.tables.length > 0)
    .map((chart) => {
      const score = sharedTables(current, chart).length / Math.sqrt(current.tables.length * chart.tables.length)
      return { id: chart.id, item: chart, score, confidence: score, reason: { kind: 'fallback' as const, becauseOf: null } }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id - b.item.id)
    .slice(0, k)
}
