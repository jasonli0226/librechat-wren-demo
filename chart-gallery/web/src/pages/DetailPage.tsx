import { Link, useParams } from 'react-router'
import { parseChartId } from '../chartId'
import { useChart, useChartList } from '../charts'
import { TableChips } from '../components/ChartCard'
import { ChartView } from '../components/ChartView'
import { DataTable } from '../components/DataTable'
import { LIBRECHAT_URL } from '../config'
import { RelatedCharts } from '../semantic/RelatedCharts'
import { useRelatedCharts } from '../semantic/useRelatedCharts'
import { relativeTime } from '../time'
import type { ChartSummary } from '../types'
import { NotFound } from './NotFound'

export function DetailPage() {
  const chartId = parseChartId(useParams().id)
  if (chartId === null) return <NotFound />
  return <ChartDetailView key={chartId} id={chartId} />
}

function ChartDetailView({ id }: { readonly id: number }) {
  const state = useChart(id)
  if (state.status === 'loading') return <p className="status">Loading chart…</p>
  if (state.status === 'error') {
    if (state.error.status === 404) return <NotFound />
    return (
      <p className="status error" role="alert">
        Could not load chart: {state.error.message}
      </p>
    )
  }
  const chart = state.data
  return (
    <article className="detail">
      <Link to="/">← All charts</Link>
      <h1>{chart.title}</h1>
      <p>{chart.description}</p>
      <div className="detail-meta">
        <span className="badge">{chart.chart_type}</span>
        <TableChips tables={chart.tables} />
        <time dateTime={chart.updated_at}>updated {relativeTime(chart.updated_at)}</time>
      </div>
      <figure className="chart-frame" aria-label={chart.title}>
        <ChartView chart={chart} />
      </figure>
      <details>
        <summary>Data table</summary>
        <DataTable chart={chart} />
      </details>
      <details>
        <summary>SQL</summary>
        <pre>
          <code>{chart.sql}</code>
        </pre>
      </details>
      <p>
        <a href={LIBRECHAT_URL}>Ask a follow-up in LibreChat</a>
      </p>
      <RelatedSection current={chart} />
    </article>
  )
}

/** Loads the list first so every chart is in the semantic store before neighbours are requested. */
function RelatedSection({ current }: { readonly current: ChartSummary }) {
  const list = useChartList()
  if (list.status !== 'ready') return null
  return <RelatedForChart current={current} charts={list.data} />
}

function RelatedForChart({ current, charts }: { readonly current: ChartSummary; readonly charts: readonly ChartSummary[] }) {
  const { rows, refining, modelStatus } = useRelatedCharts(current, charts)
  return <RelatedCharts current={current} rows={rows} refining={refining} modelStatus={modelStatus} />
}
