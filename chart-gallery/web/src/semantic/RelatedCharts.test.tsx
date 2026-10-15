import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ResultRow } from 'semantic-state'
import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import type { ChartSummary } from '../types'
import { RelatedCharts, relatedReason } from './RelatedCharts'

const row = (item: ChartSummary, score: number): ResultRow<ChartSummary> => ({
  id: item.id,
  item,
  score,
  confidence: score,
  reason: { kind: 'interest', becauseOf: 2 },
})

function show(rows: readonly ResultRow<ChartSummary>[] | null, refining = false) {
  return render(
    <MemoryRouter>
      <RelatedCharts current={SUMMARIES[1]} rows={rows} refining={refining} modelStatus={refining ? 'loading' : 'ready'} />
    </MemoryRouter>,
  )
}

describe('relatedReason', () => {
  it('combines topic and shared tables', () => {
    expect(relatedReason(SUMMARIES[1], SUMMARIES[0], true)).toBe('similar topic · shares stores')
    expect(relatedReason(SUMMARIES[1], SUMMARIES[0], false)).toBe('shares stores')
    expect(relatedReason(SUMMARIES[1], SUMMARIES[2], true)).toBe('similar topic')
  })
})

describe('RelatedCharts', () => {
  it('shows a placeholder before the first result', () => {
    show(null, true)
    expect(screen.getByText('Finding related charts…')).toBeInTheDocument()
  })

  it('shows an empty message when nothing scores above zero', () => {
    show([row(SUMMARIES[2], 0)])
    expect(screen.getByText('No related charts yet.')).toBeInTheDocument()
  })

  it('links to each related chart with its reason', () => {
    show([row(SUMMARIES[0], 0.8)])
    const region = screen.getByRole('region', { name: 'Related charts' })
    expect(region).toHaveAttribute('data-model-status', 'ready')
    const link = within(region).getByRole('link', { name: /Revenue by store/ })
    expect(link).toHaveAttribute('href', '/charts/1')
    expect(within(link).getByText('similar topic · shares stores')).toBeInTheDocument()
  })

  it('labels a table-only ranking as refining', () => {
    show([row(SUMMARIES[0], 0.5)], true)
    expect(screen.getByText('refining…')).toBeInTheDocument()
    expect(screen.getByText('shares stores')).toBeInTheDocument()
  })
})
