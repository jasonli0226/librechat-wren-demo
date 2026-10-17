import { createContext, useContext, type ReactNode } from 'react'
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartView } from '../components/ChartView'
import { DataTable } from '../components/DataTable'
import { foldPieRows, seriesColor } from '../components/chartData'
import { relativeTime } from '../time'
import { tileKey } from './rulesLayout'
import { effectiveType, type TileData } from './tileData'
import { isNumeric } from './tileTypes'
import type { Row, TilePlan, TileType, TileWidth } from './types'

export interface TileContextValue {
  readonly plans: ReadonlyMap<number, TilePlan>
  readonly data: ReadonlyMap<number, TileData>
}

export const TileContext = createContext<TileContextValue>({ plans: new Map(), data: new Map() })

export interface TileProps {
  readonly chartId: number
  readonly width: TileWidth
}

const SPAN: Record<TileWidth, number> = { quarter: 3, half: 6, full: 12 }
const LOADING: TileData = { status: 'loading' }
const CHART_HEIGHT = 240
const STACKED_HEIGHT = 96
const STAT_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const TOOLTIP_STYLE = { background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

/** Copy of `rows` sorted by `field` descending; non-numeric values go last. */
export function sortByFieldDesc(rows: readonly Row[], field: string): Row[] {
  const rank = (row: Row) => (isNumeric(row[field]) ? (row[field] as number) : -Infinity)
  return [...rows].sort((a, b) => rank(b) - rank(a) || 0)
}

export function formatStat(value: unknown): string {
  return isNumeric(value) ? STAT_FORMAT.format(value) : '—'
}

interface BodyProps {
  readonly plan: TilePlan
  readonly rows: readonly Row[]
}

function StatBody({ plan, rows }: BodyProps) {
  return <p className="tile-stat">{formatStat(rows[0]?.[plan.chart.y_fields[0]])}</p>
}

function LineBody({ plan, rows }: BodyProps) {
  return <ChartView chart={{ ...plan.chart, chart_type: 'line', rows }} height={CHART_HEIGHT} />
}

function BarBody({ plan, rows }: BodyProps) {
  const sorted = sortByFieldDesc(rows, plan.chart.y_fields[0])
  return <ChartView chart={{ ...plan.chart, chart_type: 'bar', rows: sorted }} height={CHART_HEIGHT} horizontal />
}

function TableBody({ plan, rows }: BodyProps) {
  return <DataTable chart={{ ...plan.chart, rows: sortByFieldDesc(rows, plan.chart.y_fields[0]) }} />
}

/** One horizontal bar split into parts: each row becomes a stacked segment, in palette order. */
function StackedBarBody({ plan, rows }: BodyProps) {
  const { x_field } = plan.chart
  const y = plan.chart.y_fields[0]
  const parts = foldPieRows(rows, x_field, y)
  // Index keys keep segments apart even when two rows share a label.
  const datum = Object.fromEntries(parts.map((row, i) => [`part${i}`, isNumeric(row[y]) ? row[y] : 0]))
  return (
    <ResponsiveContainer width="100%" height={STACKED_HEIGHT}>
      <BarChart data={[datum]} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis type="category" hide />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={false} />
        <Legend />
        {parts.map((row, i) => (
          <Bar key={i} dataKey={`part${i}`} name={String(row[x_field])} stackId="parts" fill={seriesColor(i)} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

const BODY: Record<TileType, (props: BodyProps) => ReactNode> = {
  stat: StatBody,
  line: LineBody,
  bar: BarBody,
  stackedBar: StackedBarBody,
  table: TableBody,
}

function Confidence({ value }: { readonly value: number | null }) {
  if (value === null) return null
  const text = value.toFixed(2)
  return (
    <span className="tile-confidence" title={`Match confidence ${text}`} aria-hidden="true">
      {text}
    </span>
  )
}

/** Shared tile frame. `type` is the component's own tile type; live data that no longer fits it shows as a table. */
function Tile({ chartId, width, type }: TileProps & { readonly type: TileType }) {
  const { plans, data } = useContext(TileContext)
  const plan = plans.get(chartId)
  if (!plan) return null
  const tileData = data.get(chartId) ?? LOADING
  const Body = BODY[effectiveType({ ...plan, type }, tileData)]
  return (
    <article
      className={`tile tile-${type}`}
      style={{ viewTransitionName: tileKey(chartId), gridColumn: `span ${SPAN[width]}` }}
    >
      <header className="tile-head">
        <h3 className="tile-title">{plan.chart.title}</h3>
        <Confidence value={plan.confidence} />
      </header>
      {tileData.status === 'loading' ? (
        <div className="tile-skeleton" role="status" aria-label="Loading" />
      ) : (
        <Body plan={plan} rows={tileData.rows} />
      )}
      {tileData.status === 'snapshot' ? <p className="tile-note">snapshot from {relativeTime(tileData.since)}</p> : null}
    </article>
  )
}

export const StatTile = (props: TileProps) => <Tile {...props} type="stat" />
export const LineTile = (props: TileProps) => <Tile {...props} type="line" />
export const BarTile = (props: TileProps) => <Tile {...props} type="bar" />
export const StackedBarTile = (props: TileProps) => <Tile {...props} type="stackedBar" />
export const TableTile = (props: TileProps) => <Tile {...props} type="table" />
