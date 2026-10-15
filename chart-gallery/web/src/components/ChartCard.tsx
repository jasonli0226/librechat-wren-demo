import { Link } from 'react-router'
import { relativeTime } from '../time'
import type { ChartSummary } from '../types'

export function TableChips({ tables }: { readonly tables: readonly string[] }) {
  if (tables.length === 0) return null
  return (
    <ul className="chips" aria-label="Tables">
      {tables.map((table) => (
        <li key={table}>
          <code>{table}</code>
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({ chart }: { readonly chart: ChartSummary }) {
  return (
    <Link to={`/charts/${chart.id}`} className="card">
      <span className="card-meta">
        <span className="badge">{chart.chart_type}</span>
        <time dateTime={chart.updated_at}>{relativeTime(chart.updated_at)}</time>
      </span>
      <h2 className="card-title">{chart.title}</h2>
      <p className="card-desc">{chart.description}</p>
      <TableChips tables={chart.tables} />
    </Link>
  )
}
