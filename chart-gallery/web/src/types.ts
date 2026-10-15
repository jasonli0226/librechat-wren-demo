export type ChartType = 'line' | 'bar' | 'pie'

export interface ChartSummary {
  readonly id: number
  readonly title: string
  readonly description: string
  readonly chart_type: ChartType
  readonly tables: readonly string[]
  readonly updated_at: string
}

export interface ChartDetail extends ChartSummary {
  readonly x_field: string
  readonly y_fields: readonly string[]
  readonly sql: string
  readonly rows: readonly Record<string, unknown>[]
  readonly created_at: string
}
