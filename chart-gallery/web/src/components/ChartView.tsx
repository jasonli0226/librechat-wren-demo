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
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartDetail } from '../types'
import { scatterAxes, type ScatterAxes } from '../chartShape'
import { DataTable } from './DataTable'
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
  const axes = chart.chart_type === 'scatter' ? scatterAxes(chart, chart.rows) : null
  // A scatter that no longer fits is a plain table, not a chart inside a sized container.
  if (chart.chart_type === 'scatter' && axes === null) return <DataTable chart={chart} />
  const plot = axes ? renderScatter(chart, axes, size) : renderOther(chart, horizontal, size)
  if (width !== undefined) return plot
  return (
    <ResponsiveContainer width="100%" height={height}>
      {plot}
    </ResponsiveContainer>
  )
}

function renderOther(chart: ChartSpec, horizontal: boolean, size: { width?: number; height?: number }): ReactElement {
  if (horizontal && chart.chart_type === 'bar') return renderHorizontalBars(chart, size)
  return renderPlot(chart, size)
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

// Scatter points are re-keyed to these so every series can share one pair of axes.
const POINT_X = 'x'
const POINT_Y = 'y'
const POINT_LABEL = 'label'
const POINT_SERIES = 'series'

/** Points for one scatter series; each carries its own series name and row label for the tooltip. */
export function scatterPoints(rows: readonly Record<string, unknown>[], axes: ScatterAxes, field: string) {
  const labelField = axes.mode === 'pair' ? axes.label : axes.x
  return rows.map((r) => ({
    [POINT_X]: r[axes.x],
    [POINT_Y]: r[field],
    [POINT_LABEL]: r[labelField],
    [POINT_SERIES]: field,
  }))
}

/** Tooltip: pair mode heads it with the row label; x mode with the hovered point's series. */
function ScatterTooltip({ active, payload, axes }: {
  active?: boolean
  payload?: { payload: Record<string, unknown> }[]
  axes: ScatterAxes
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const series = String(point[POINT_SERIES])
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '6px 10px' }}>
      <p>{String(axes.mode === 'pair' ? point[POINT_LABEL] : series)}</p>
      <p>{axes.x}: {String(point[POINT_X])}</p>
      <p>{series}: {String(point[POINT_Y])}</p>
    </div>
  )
}

function renderScatter(chart: ChartSpec, axes: ScatterAxes, size: { width?: number; height?: number }): ReactElement {
  const rows = chart.rows as Record<string, unknown>[]
  return (
    <ScatterChart {...size}>
      <CartesianGrid stroke="var(--border)" />
      <XAxis type="number" dataKey={POINT_X} name={axes.x} tick={AXIS_TICK} />
      <YAxis type="number" dataKey={POINT_Y} tick={AXIS_TICK} />
      <Tooltip cursor={false} content={<ScatterTooltip axes={axes} />} />
      {axes.ys.length > 1 ? <Legend /> : null}
      {axes.ys.map((field, i) => (
        <Scatter key={field} data={scatterPoints(rows, axes, field)} name={field} fill={seriesColor(i)} isAnimationActive={false} />
      ))}
    </ScatterChart>
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
