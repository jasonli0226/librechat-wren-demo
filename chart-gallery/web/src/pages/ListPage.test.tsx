import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SUMMARIES } from '../test/fixtures'
import { fail, mockApi, ok } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

describe('ListPage', () => {
  it('lists charts and hands them to the semantic store', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    const { store } = renderApp('/')
    expect(await screen.findByRole('link', { name: /Revenue by store/ })).toHaveAttribute('href', '/charts/1')
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(store.upsert).toHaveBeenCalledWith(SUMMARIES)
  })

  it('filters by title and description', async () => {
    mockApi({ '/api/charts': ok(SUMMARIES) })
    renderApp('/')
    await userEvent.type(await screen.findByRole('searchbox'), 'loyalty')
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Revenue by store/ })).toBeNull()
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No charts match “zzz”.')).toBeInTheDocument()
  })

  it('explains how to create the first chart', async () => {
    mockApi({ '/api/charts': ok([]) })
    renderApp('/')
    expect(await screen.findByText(/No charts yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open LibreChat' })).toHaveAttribute('href', 'http://localhost:3080')
  })

  it('shows an alert when the API is unreachable', async () => {
    mockApi({ '/api/charts': 'network-error' })
    renderApp('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load charts: Chart gallery API is unreachable')
  })

  it('shows an alert for an API error', async () => {
    mockApi({ '/api/charts': fail(503, 'database unavailable') })
    renderApp('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable')
  })

  it('renders hostile titles as text', async () => {
    const hostile = { ...SUMMARIES[0], title: '<img src=x onerror=alert(1)>', description: '<script>alert(2)</script>' }
    mockApi({ '/api/charts': ok([hostile]) })
    const { container } = renderApp('/')
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
