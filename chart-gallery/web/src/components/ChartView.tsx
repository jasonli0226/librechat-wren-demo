import type { ReactElement } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartDetail } from '../types'
import { foldPieRows, seriesColor } from './chartData'

export type ChartSpec = Pick<ChartDetail, 'chart_type' | 'x_field' | 'y_fields' | 'rows'>

interface Props {
  readonly chart: ChartSpec
  readonly height?: number
  /** Fixed width instead of filling the parent (used by tests). */
  readonly width?: number
  /** Draw bar charts with horizontal bars (categories on the y axis). */
  readonly horizontal?: boolean
}

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 12 }
const TOOLTIP_STYLE = { background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

export function ChartView({ chart, height = 320, width, horizontal = false }: Props) {
  const size = width === undefined ? {} : { width, height }
  const plot = horizontal && chart.chart_type === 'bar' ? renderHorizontalBars(chart, size) : renderPlot(chart, size)
  if (width !== undefined) return plot
  return (
    <ResponsiveContainer width="100%" height={height}>
      {plot}
    </ResponsiveContainer>
  )
}

function renderPlot(chart: ChartSpec, size: { width?: number; height?: number }): ReactElement {
  const { chart_type, x_field, y_fields } = chart
  const rows = chart.rows as Record<string, unknown>[]
  const showLegend = y_fields.length > 1

  if (chart_type === 'pie') {
    const data = foldPieRows(rows, x_field, y_fields[0])
    return (
      <PieChart {...size}>
        <Pie data={data} dataKey={y_fields[0]} nameKey={x_field} isAnimationActive={false} stroke="var(--surface-1)" strokeWidth={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={seriesColor(i)} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
      </PieChart>
    )
  }

  const axes = [
    <CartesianGrid key="grid" stroke="var(--border)" vertical={false} />,
    <XAxis key="x" dataKey={x_field} tick={AXIS_TICK} />,
    <YAxis key="y" tick={AXIS_TICK} />,
    <Tooltip key="tip" contentStyle={TOOLTIP_STYLE} />,
    showLegend ? <Legend key="legend" /> : null,
  ]

  if (chart_type === 'line') {
    return (
      <LineChart data={rows} {...size}>
        {axes}
        {y_fields.map((field, i) => (
          <Line key={field} dataKey={field} name={field} stroke={seriesColor(i)} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    )
  }

  return (
    <BarChart data={rows} {...size}>
      {axes}
      {y_fields.map((field, i) => (
        <Bar key={field} dataKey={field} name={field} fill={seriesColor(i)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}

const CATEGORY_AXIS_WIDTH = 120

function renderHorizontalBars(chart: ChartSpec, size: { width?: number; height?: number }): ReactElement {
  const { x_field, y_fields } = chart
  return (
    <BarChart data={chart.rows as Record<string, unknown>[]} layout="vertical" {...size}>
      <CartesianGrid stroke="var(--border)" horizontal={false} />
      <XAxis type="number" tick={AXIS_TICK} />
      <YAxis type="category" dataKey={x_field} tick={AXIS_TICK} width={CATEGORY_AXIS_WIDTH} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      {y_fields.length > 1 ? <Legend /> : null}
      {y_fields.map((field, i) => (
        <Bar key={field} dataKey={field} name={field} fill={seriesColor(i)} radius={[0, 4, 4, 0]} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}
