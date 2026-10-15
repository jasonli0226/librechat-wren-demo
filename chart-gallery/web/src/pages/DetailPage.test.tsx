import { screen, within } from '@testing-library/react'
import { similarKey } from 'semantic-state'
import { describe, expect, it } from 'vitest'
import { DETAIL, SUMMARIES } from '../test/fixtures'
import { createFakeStore } from '../test/fakeStore'
import { fail, mockApi, ok } from '../test/mockApi'
import { renderApp } from '../test/renderApp'
import { parseChartId } from './DetailPage'

describe('parseChartId', () => {
  it.each([
    ['2', 2],
    ['abc', null],
    ['0', null],
    ['-1', null],
    ['1.5', null],
    [undefined, null],
  ])('%s → %s', (raw, expected) => {
    expect(parseChartId(raw)).toBe(expected)
  })
})

describe('DetailPage', () => {
  it('shows the chart, its SQL, data table and related charts', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL), '/api/charts': ok(SUMMARIES) })
    const { store } = createFakeStore({
      similar: {
        [similarKey(2, 3)]: [
          { id: 1, item: SUMMARIES[0], score: 0.8, confidence: 0.8, reason: { kind: 'interest', becauseOf: 2 } },
        ],
      },
    })
    renderApp('/charts/2', store)
    expect(await screen.findByRole('heading', { level: 1, name: 'Return rate by store' })).toBeInTheDocument()
    expect(screen.getByText(DETAIL.sql)).toBeInTheDocument()
    const related = await screen.findByRole('region', { name: 'Related charts' })
    expect(within(related).getByRole('link', { name: /Revenue by store/ })).toHaveAttribute('href', '/charts/1')
  })

  it('shows a dash for null cells', async () => {
    mockApi({ '/api/charts/2': ok(DETAIL), '/api/charts': ok(SUMMARIES) })
    renderApp('/charts/2')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('—')).toBeInTheDocument()
    expect(within(table).getByText('0.12')).toBeInTheDocument()
  })

  it('shows not found for a bad id without calling the API', () => {
    const fetchMock = mockApi({})
    renderApp('/charts/abc')
    expect(screen.getByRole('heading', { name: 'Chart not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows not found for a missing chart', async () => {
    mockApi({ '/api/charts/9': fail(404, 'chart not found') })
    renderApp('/charts/9')
    expect(await screen.findByRole('heading', { name: 'Chart not found' })).toBeInTheDocument()
  })

  it('shows an alert for other errors', async () => {
    mockApi({ '/api/charts/2': fail(500, 'boom') })
    renderApp('/charts/2')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load chart: boom')
  })
})
