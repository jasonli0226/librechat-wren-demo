import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSemantic } from 'semantic-state/react'
import { useChartList } from '../charts'
import { ChartCard } from '../components/ChartCard'
import { LIBRECHAT_URL } from '../config'
import { parseDashboardParams, dashboardHref } from '../dashboard/selection'
import { filterCharts } from '../filter'
import type { ChartSummary } from '../types'

function EmptyGallery() {
  return (
    <div className="status">
      <p>
        No charts yet. Ask the Retail Analyst a question and request a chart — for example “Show revenue by store as a
        bar chart.” — and it will appear here.
      </p>
      <a href={LIBRECHAT_URL}>Open LibreChat</a>
    </div>
  )
}

export function ListPage() {
  const state = useChartList()
  const [query, setQuery] = useState('')
  const [searchParams] = useSearchParams()
  const trimmed = query.trim()
  const semantic = useSemantic<ChartSummary>(trimmed, { commit: 'live' })
  if (state.status === 'loading') return <p className="status">Loading charts…</p>
  if (state.status === 'error') {
    return (
      <p className="status error" role="alert">
        Could not load charts: {state.error.message}
      </p>
    )
  }
  if (state.data.length === 0) return <EmptyGallery />
  // Only a min given in the URL filters the ranking; the substring filter answers until the model catches up.
  const urlMin = searchParams.has('min') ? parseDashboardParams(searchParams).min : null
  const visible =
    trimmed !== '' && semantic.resultQuery === trimmed
      ? semantic.beliefs.filter((b) => urlMin === null || b.confidence >= urlMin).map((b) => b.value)
      : filterCharts(state.data, query)
  return (
    <>
      <div className="toolbar">
        <label>
          <span className="visually-hidden">Filter charts</span>
          <input
            type="search"
            placeholder="Filter by title or description"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="count">
          {visible.length} of {state.data.length}
        </span>
        {trimmed !== '' && (
          <Link to={dashboardHref({ kind: 'query', q: trimmed }, urlMin ?? undefined)}>Build dashboard</Link>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="status">No charts match “{query}”.</p>
      ) : (
        <div className="grid">
          {visible.map((chart) => (
            <ChartCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </>
  )
}
