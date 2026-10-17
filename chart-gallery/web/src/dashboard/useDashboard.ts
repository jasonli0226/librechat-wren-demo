import type { Spec } from '@json-render/core'
import { useEffect, useMemo, useState } from 'react'
import { useSemantic, useSemanticSnapshot, useSimilar } from 'semantic-state/react'
import { type ArrangeTile, arrangeDashboard, fetchChart } from '../api'
import { useChartList } from '../charts'
import { filterCharts } from '../filter'
import { rankByTables } from '../semantic/features'
import type { ChartSummary } from '../types'
import { validateArrangement } from './arrangement'
import { buildRulesSpec } from './rulesLayout'
import { type DashboardParams, type DashboardSource, MODEL_WAIT_MS, type Ranked, dashboardHref, selectCharts } from './selection'
import { type TileData, useTileData } from './tileData'
import { planTiles } from './tileTypes'
import { swapLayout } from './transition'
import type { TilePlan } from './types'

export const ARRANGE_TIMEOUT_MS = 8000
export const RULES_NOTE = 'Arranged by rules'

export type DashboardState =
  | { status: 'invalid' }
  | { status: 'missing'; message: string }
  | { status: 'selecting' }
  | {
      status: 'ready'
      plans: TilePlan[]
      spec: Spec
      note: string | null
      belowThreshold: boolean
      data: ReadonlyMap<number, TileData>
    }

type Outcome =
  | { kind: 'missing'; message: string }
  | { kind: 'picked'; picked: { id: number; confidence: number | null }[]; belowThreshold: boolean }

/** Each stage remembers which build it belongs to, so a stale result is never shown for a newer build. */
interface Keyed<T> {
  key: string
  value: T
}

type Built = { kind: 'missing'; message: string } | { kind: 'built'; plans: TilePlan[]; spec: Spec }

const NO_PLANS: TilePlan[] = []

const missing = (message: string): Outcome => ({ kind: 'missing', message })

const byConfidence = (rows: readonly Ranked[]): Ranked[] => [...rows].sort((a, b) => b.confidence - a.confidence)

/** The model's ranking for the source, or null while it is not usable yet. */
function useRanking(source: DashboardSource | null, max: number): Ranked[] | null {
  const snapshot = useSemanticSnapshot<ChartSummary>()
  const similar = useSimilar<ChartSummary>(source?.kind === 'chart' ? source.id : null, max - 1)
  const semantic = useSemantic<ChartSummary>(source?.kind === 'query' ? source.q : '', { commit: 'live' })
  const ready = snapshot.model.status === 'ready'
  const { beliefs, query, resultQuery } = semantic
  return useMemo(() => {
    if (!ready || source === null) return null
    if (source.kind === 'chart') {
      return similar === null ? null : byConfidence(similar.map((r) => ({ item: r.item, confidence: r.confidence })))
    }
    // `beliefs` lags `resultQuery` by a render under the commit policy, so an empty list is not an answer yet.
    if (resultQuery !== query || beliefs.length === 0) return null
    return byConfidence(beliefs.map((b) => ({ item: b.value, confidence: b.confidence })))
  }, [ready, source, similar, beliefs, query, resultQuery])
}

/** True once `ms` have passed since `key` was first seen. */
function useExpired(key: string | null, ms: number): boolean {
  const [expired, setExpired] = useState<string | null>(null)
  useEffect(() => {
    if (key === null) return
    const timer = setTimeout(() => setExpired(key), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return key !== null && expired === key
}

function choose(
  source: DashboardSource,
  charts: readonly ChartSummary[],
  ranked: readonly Ranked[] | null,
  { min, max }: DashboardParams,
): Outcome {
  let seed: ChartSummary | null = null
  let fallback: ChartSummary[]
  if (source.kind === 'chart') {
    seed = charts.find((c) => c.id === source.id) ?? null
    if (seed === null) return missing(`Chart ${source.id} was not found.`)
    fallback = rankByTables(seed, charts, max - 1).map((r) => r.item)
  } else {
    fallback = filterCharts(charts, source.q)
  }
  const selection = selectCharts({ seed, ranked, fallback, min, max })
  if (selection.picked.length === 0) return missing(`No charts match “${source.kind === 'query' ? source.q : ''}”.`)
  // The hint only helps when the ranking had candidates besides the seed that a lower threshold would admit.
  const hadOthers = (ranked ?? []).some((r) => r.item.id !== seed?.id)
  return { kind: 'picked', picked: selection.picked, belowThreshold: selection.belowThreshold && hadOthers }
}

/** Picks the charts once per build: when the ranking is usable or the model wait ran out, whichever is first. */
function useFrozenSelection(key: string | null, params: DashboardParams): Keyed<Outcome> | null {
  const list = useChartList()
  const ranked = useRanking(params.source, params.max)
  const expired = useExpired(key, MODEL_WAIT_MS)
  const [frozen, setFrozen] = useState<Keyed<Outcome> | null>(null)

  useEffect(() => {
    const { source } = params
    if (key === null || source === null || frozen?.key === key || list.status === 'loading') return
    if (list.status === 'error') {
      setFrozen({ key, value: missing(`Could not load charts: ${list.error.message}`) })
      return
    }
    // An unknown seed can be reported as soon as the list is in; only ranking needs the model.
    const unknownSeed = source.kind === 'chart' && !list.data.some((c) => c.id === source.id)
    if (ranked === null && !expired && !unknownSeed) return
    setFrozen({ key, value: choose(source, list.data, ranked, params) })
  }, [key, params, frozen, list, ranked, expired])

  return frozen?.key === key ? frozen : null
}

/** Loads the picked charts and lays them out by rules. */
function useRulesBuild(selection: Keyed<Outcome> | null): Keyed<Built> | null {
  const [built, setBuilt] = useState<Keyed<Built> | null>(null)

  useEffect(() => {
    if (selection === null || selection.value.kind !== 'picked') return
    const { key } = selection
    const { picked } = selection.value
    let active = true
    Promise.allSettled(picked.map((p) => fetchChart(p.id))).then((results) => {
      if (!active) return
      // A chart that fails to load is left out rather than failing the whole dashboard.
      const charts = results.flatMap((r, i) =>
        r.status === 'fulfilled' ? [{ chart: r.value, confidence: picked[i].confidence }] : [],
      )
      if (charts.length === 0) {
        setBuilt({ key, value: { kind: 'missing', message: 'Could not load the selected charts.' } })
        return
      }
      const plans = planTiles(charts)
      setBuilt({ key, value: { kind: 'built', plans, spec: buildRulesSpec(plans) } })
    })
    return () => {
      active = false
    }
  }, [selection])

  return built?.key === selection?.key ? built : null
}

const toArrangeTiles = (plans: readonly TilePlan[]): ArrangeTile[] =>
  plans.map((p, rank) => ({
    chart_id: p.chart.id,
    type: p.type,
    allowed_types: [...p.allowed],
    rank,
    confidence: p.confidence,
  }))

interface Layout {
  spec: Spec
  note: string | null
}

/**
 * Asks the API to arrange the tiles once per build and swaps to the answer when it validates.
 * Any failure, or no answer within the timeout, keeps the rules layout; later answers are dropped.
 */
function useArrangement(build: Keyed<Built> | null): Keyed<Layout> | null {
  const [layout, setLayout] = useState<Keyed<Layout> | null>(null)

  useEffect(() => {
    if (build === null || build.value.kind !== 'built') return
    const { key } = build
    const { plans, spec: rulesSpec } = build.value
    const controller = new AbortController()
    let settled = false
    const finish = (next: Layout, swap: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      controller.abort()
      const apply = () => setLayout({ key, value: next })
      if (swap) swapLayout(apply)
      else apply()
    }
    const keepRules = () => finish({ spec: rulesSpec, note: RULES_NOTE }, false)
    const timer = setTimeout(keepRules, ARRANGE_TIMEOUT_MS)

    arrangeDashboard(toArrangeTiles(plans), controller.signal).then(({ spec, headlines }) => {
      const result = validateArrangement(spec, plans, headlines)
      if (result.ok) finish({ spec: result.spec, note: null }, true)
      else keepRules()
    }, keepRules)

    return () => {
      settled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [build])

  return layout?.key === build?.key ? layout : null
}

export function useDashboard(params: DashboardParams, buildId: number): DashboardState {
  const { source, min, max } = params
  const key = source === null ? null : `${buildId} ${dashboardHref(source, min, max)}`
  const selection = useFrozenSelection(key, params)
  const build = useRulesBuild(selection)
  const layout = useArrangement(build)
  const plans = build?.value.kind === 'built' ? build.value.plans : NO_PLANS
  const data = useTileData(plans)

  if (source === null) return { status: 'invalid' }
  if (selection === null) return { status: 'selecting' }
  if (selection.value.kind === 'missing') return { status: 'missing', message: selection.value.message }
  if (build === null) return { status: 'selecting' }
  if (build.value.kind === 'missing') return { status: 'missing', message: build.value.message }
  return {
    status: 'ready',
    plans: build.value.plans,
    spec: layout?.value.spec ?? build.value.spec,
    note: layout?.value.note ?? null,
    belowThreshold: selection.value.belowThreshold,
    data,
  }
}
