import { Link } from 'react-router'
import type { ModelState, ResultRow } from 'semantic-state'
import type { ChartSummary } from '../types'
import { sharedTables } from './features'

export function relatedReason(current: ChartSummary, other: ChartSummary, topicReady: boolean): string {
  const shared = sharedTables(current, other)
  return [topicReady ? 'similar topic' : null, shared.length > 0 ? `shares ${shared.join(', ')}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

interface Props {
  readonly current: ChartSummary
  readonly rows: readonly ResultRow<ChartSummary>[] | null
  readonly refining: boolean
  readonly modelStatus: ModelState['status']
}

export function RelatedCharts({ current, rows, refining, modelStatus }: Props) {
  const topicReady = modelStatus === 'ready' && !refining
  const visible = (rows ?? []).filter((row) => row.score > 0)
  return (
    <section className="related" aria-labelledby="related-heading" aria-busy={refining} data-model-status={modelStatus}>
      <h2 id="related-heading">
        Related charts
        {refining && <span className="refining">refining…</span>}
      </h2>
      {rows === null ? (
        <p className="status">Finding related charts…</p>
      ) : visible.length === 0 ? (
        <p className="status">No related charts yet.</p>
      ) : (
        <ul>
          {visible.map(({ item }) => (
            <li key={item.id}>
              <Link to={`/charts/${item.id}`}>
                {item.title}
                <span className="reason">{relatedReason(current, item, topicReady)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
