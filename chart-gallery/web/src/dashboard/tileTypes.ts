import type { ChartDetail } from '../types'
import type { Row, TilePlan, TileType } from './types'

const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}.*)?$/
const MIN_LINE_ROWS = 2
const MAX_STACKED_ROWS = 7
const MAX_BAR_ROWS = 20
const MAX_SCALE_RATIO = 100

type ChartShape = Pick<ChartDetail, 'chart_type' | 'x_field' | 'y_fields'>

export function isNumeric(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isLineShaped(chart: ChartShape, rows: readonly Row[]): boolean {
  return (
    rows.length >= MIN_LINE_ROWS &&
    rows.every((r) => {
      const x = r[chart.x_field]
      return typeof x === 'string' && DATE_LIKE.test(x)
    })
  )
}

// Max absolute numeric value per y field; null when a field has no numeric values.
function yScalesWithin(chart: ChartShape, rows: readonly Row[]): boolean {
  const maxima = chart.y_fields.map((f) => {
    const nums = rows.map((r) => r[f]).filter(isNumeric)
    return nums.length === 0 ? null : Math.max(...nums.map(Math.abs))
  })
  if (maxima.some((m) => m === null)) return false
  const values = maxima as number[]
  const hi = Math.max(...values)
  const lo = Math.min(...values)
  return lo === 0 ? hi === 0 : hi / lo <= MAX_SCALE_RATIO
}

export function fittingTypes(chart: ChartShape, rows: readonly Row[]): TileType[] {
  const n = rows.length
  const single = chart.y_fields.length === 1
  const line = isLineShaped(chart, rows)
  const types: TileType[] = []

  if (n === 1 && single && isNumeric(rows[0][chart.y_fields[0]])) types.push('stat')
  if (line) types.push('line')
  const hasNumbers = rows.some((r) => isNumeric(r[chart.y_fields[0]]))
  if (!line && n >= MIN_LINE_ROWS && n <= MAX_STACKED_ROWS && single && chart.chart_type === 'pie' && hasNumbers) {
    types.push('stackedBar')
  }
  if (!line && n >= 1 && n <= MAX_BAR_ROWS && yScalesWithin(chart, rows)) types.push('bar')
  types.push('table')
  return types
}

const SWAP: Partial<Record<TileType, TileType>> = { bar: 'table', table: 'bar' }

function applyVariety(plans: readonly TilePlan[]): TilePlan[] {
  const out: TilePlan[] = []
  for (const plan of plans) {
    const prev = out[out.length - 1]
    const other = SWAP[plan.type]
    const swap = prev && prev.type === plan.type && other && plan.allowed.includes(other)
    out.push(swap ? { ...plan, type: other } : plan)
  }
  return out
}

export function planTiles(
  charts: readonly { chart: ChartDetail; confidence: number | null }[],
): TilePlan[] {
  const plans = charts.map(({ chart, confidence }) => {
    const allowed = fittingTypes(chart, chart.rows)
    return { chart, type: allowed[0], allowed, confidence }
  })
  return applyVariety(plans)
}
