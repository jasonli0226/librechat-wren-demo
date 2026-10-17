import { parseChartId } from '../chartId'
import type { ChartSummary } from '../types'

export const DEFAULT_MIN = 0.3
export const DEFAULT_MAX = 6
export const MODEL_WAIT_MS = 1500

export const MIN_BOUNDS = { lo: 0, hi: 1 } as const
export const MAX_BOUNDS = { lo: 1, hi: 12 } as const
const MAX_QUERY_LENGTH = 200

export type DashboardSource = { kind: 'chart'; id: number } | { kind: 'query'; q: string }

export interface DashboardParams {
  source: DashboardSource | null
  min: number
  max: number
}

function parseNumber(raw: string | null, fallback: number, lo: number, hi: number): number {
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function parseSource(search: URLSearchParams): DashboardSource | null {
  const from = search.get('from')
  const q = search.get('q')?.trim().slice(0, MAX_QUERY_LENGTH) ?? ''
  if (from !== null && q !== '') return null
  if (from !== null) {
    const id = parseChartId(from)
    return id === null ? null : { kind: 'chart', id }
  }
  return q === '' ? null : { kind: 'query', q }
}

export function parseDashboardParams(search: URLSearchParams): DashboardParams {
  return {
    source: parseSource(search),
    min: parseNumber(search.get('min'), DEFAULT_MIN, MIN_BOUNDS.lo, MIN_BOUNDS.hi),
    max: Math.floor(parseNumber(search.get('max'), DEFAULT_MAX, MAX_BOUNDS.lo, MAX_BOUNDS.hi)),
  }
}

export function dashboardHref(source: DashboardSource, min?: number, max?: number): string {
  const params = new URLSearchParams()
  if (source.kind === 'chart') params.set('from', String(source.id))
  else params.set('q', source.q)
  if (min !== undefined) params.set('min', String(min))
  if (max !== undefined) params.set('max', String(max))
  return `/dashboard?${params.toString()}`
}

export interface Ranked {
  item: ChartSummary
  confidence: number
}

export interface Selection {
  picked: { id: number; confidence: number | null }[]
  usedFallback: boolean
  belowThreshold: boolean
}

interface SelectInput {
  seed: ChartSummary | null
  ranked: readonly Ranked[] | null
  fallback: readonly ChartSummary[]
  min: number
  max: number
}

export function selectCharts({ seed, ranked, fallback, min, max }: SelectInput): Selection {
  const seedPick = seed ? [{ id: seed.id, confidence: null }] : []

  if (ranked === null) {
    const rest = fallback
      .filter((c) => c.id !== seed?.id)
      .map((c) => ({ id: c.id, confidence: null }))
    return {
      picked: [...seedPick, ...rest].slice(0, max),
      usedFallback: true,
      belowThreshold: false,
    }
  }

  const others = ranked.filter((r) => r.item.id !== seed?.id)
  const passing = others
    .filter((r) => r.confidence >= min)
    .map((r) => ({ id: r.item.id, confidence: r.confidence }))

  if (passing.length > 0) {
    return {
      picked: [...seedPick, ...passing].slice(0, max),
      usedFallback: false,
      belowThreshold: false,
    }
  }
  if (seed) return { picked: seedPick, usedFallback: false, belowThreshold: true }
  const best = others.reduce<Ranked | null>(
    (top, r) => (top === null || r.confidence > top.confidence ? r : top),
    null,
  )
  if (best === null) return { picked: [], usedFallback: false, belowThreshold: false }
  return {
    picked: [{ id: best.item.id, confidence: best.confidence }],
    usedFallback: false,
    belowThreshold: true,
  }
}
