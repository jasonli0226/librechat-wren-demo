import type { Row } from './dashboard/types'
import type { ChartDetail } from './types'

// Twin of api/gallery/shape.py; both are pinned by fixtures/chart-shapes.json.
const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}.*)?$/
const MIN_LINE_ROWS = 2
const YEAR_MIN = 1900
const YEAR_MAX = 2100
export const MIN_SCATTER_ROWS = 5
const MIN_PAIR_FIELDS = 2

export type ScatterAxes =
  | { mode: 'x'; x: string; ys: string[] }
  | { mode: 'pair'; x: string; ys: [string]; label: string }

export function isNumeric(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isYear(v: unknown): boolean {
  return isNumeric(v) && Number.isInteger(v) && v >= YEAR_MIN && v <= YEAR_MAX
}

export function isLineShaped(chart: Pick<ChartDetail, 'x_field'>, rows: readonly Row[]): boolean {
  return (
    rows.length >= MIN_LINE_ROWS &&
    rows.every((r) => {
      const x = r[chart.x_field]
      return (typeof x === 'string' && DATE_LIKE.test(x)) || isYear(x)
    })
  )
}

export function scatterAxes(
  chart: Pick<ChartDetail, 'x_field' | 'y_fields'>,
  rows: readonly Row[],
): ScatterAxes | null {
  if (rows.length < MIN_SCATTER_ROWS || isLineShaped(chart, rows)) return null
  const ys = chart.y_fields.filter((f) => rows.some((r) => isNumeric(r[f])))
  if (ys.length > 0 && rows.every((r) => isNumeric(r[chart.x_field]))) {
    return { mode: 'x', x: chart.x_field, ys }
  }
  if (ys.length >= MIN_PAIR_FIELDS) {
    return { mode: 'pair', x: ys[0], ys: [ys[1]], label: chart.x_field }
  }
  return null
}
