import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartView, type ChartSpec } from './ChartView'

const months = [
  { month: '2026-01-01T00:00:00', revenue: 10, orders: 3 },
  { month: '2026-02-01T00:00:00', revenue: null, orders: 4 },
  { month: '2026-03-01T00:00:00', revenue: 12, orders: null },
]

function draw(chart: ChartSpec) {
  return render(<ChartView chart={chart} width={600} height={300} />)
}

describe('ChartView', () => {
  it('renders a line chart with null values and a legend for two series', () => {
    const { container } = draw({ chart_type: 'line', x_field: 'month', y_fields: ['revenue', 'orders'], rows: months })
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
    expect(screen.getByText('revenue')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
  })

  it('renders a single-series bar chart without a legend', () => {
    const { container } = draw({
      chart_type: 'bar',
      x_field: 'store',
      y_fields: ['revenue'],
      rows: [{ store: 'Central', revenue: 5 }, { store: 'Kowloon', revenue: 7 }],
    })
    expect(container.querySelector('.recharts-bar')).not.toBeNull()
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull()
  })

  it('renders a pie with one sector per row', () => {
    const { container } = draw({
      chart_type: 'pie',
      x_field: 'tier',
      y_fields: ['customers'],
      rows: [{ tier: 'gold', customers: 5 }, { tier: 'silver', customers: 7 }, { tier: 'bronze', customers: 9 }],
    })
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3)
  })

  it('renders a scatter chart for numeric x', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ x: i * 1.5, y: i + 1 }))
    const { container } = draw({ chart_type: 'scatter', x_field: 'x', y_fields: ['y'], rows })
    expect(container.querySelector('.recharts-scatter')).not.toBeNull()
  })

  it('falls back to a table when scatter has a text x and one y', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ x: `c${i}`, y: i + 1 }))
    draw({ chart_type: 'scatter', x_field: 'x', y_fields: ['y'], rows })
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
