import type { ChartDetail, ChartSummary } from '../types'

export const SUMMARIES: ChartSummary[] = [
  { id: 1, title: 'Revenue by store', description: 'Completed revenue for each store.', chart_type: 'bar', tables: ['orders', 'stores'], updated_at: '2026-10-16T10:00:00+00:00' },
  { id: 2, title: 'Return rate by store', description: 'Share of orders returned per store.', chart_type: 'bar', tables: ['returns', 'stores'], updated_at: '2026-10-16T09:00:00+00:00' },
  { id: 3, title: 'Customers by loyalty tier', description: 'Customer count in each loyalty tier.', chart_type: 'pie', tables: ['customers'], updated_at: '2026-10-15T09:00:00+00:00' },
]

export const DETAIL: ChartDetail = {
  ...SUMMARIES[1],
  x_field: 'store_name',
  y_fields: ['return_rate'],
  sql: 'SELECT s.store_name, AVG(r.rate) AS return_rate FROM stores s JOIN returns r ON r.store_id = s.store_id GROUP BY 1',
  rows: [
    { store_name: 'Central', return_rate: 0.12 },
    { store_name: 'Kowloon', return_rate: null },
  ],
  created_at: '2026-10-16T09:00:00+00:00',
}
