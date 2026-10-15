export const SERIES_COUNT = 8

/** Categorical colour for series/slice `index`, in the palette's fixed order. Never cycles. */
export function seriesColor(index: number): string {
  if (index < 0 || index >= SERIES_COUNT) throw new Error(`no colour slot ${index + 1}`)
  return `var(--series-${index + 1})`
}

type Row = Readonly<Record<string, unknown>>

const valueOf = (row: Row, field: string) => (typeof row[field] === 'number' ? (row[field] as number) : 0)

/** Keeps a pie to `max` slices: the largest `max - 1` plus "Other" holding the rest. */
export function foldPieRows(rows: readonly Row[], xField: string, yField: string, max = SERIES_COUNT): Row[] {
  if (rows.length <= max) return [...rows]
  const sorted = [...rows].sort((a, b) => valueOf(b, yField) - valueOf(a, yField))
  const kept = sorted.slice(0, max - 1)
  const rest = sorted.slice(max - 1).reduce((sum, row) => sum + valueOf(row, yField), 0)
  return [...kept, { [xField]: 'Other', [yField]: rest }]
}
