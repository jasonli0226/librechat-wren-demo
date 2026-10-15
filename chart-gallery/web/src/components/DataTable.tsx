import type { ChartDetail } from '../types'

const formatCell = (value: unknown) =>
  value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('en') : String(value)

export function DataTable({ chart }: { readonly chart: Pick<ChartDetail, 'x_field' | 'y_fields' | 'rows'> }) {
  const columns = [chart.x_field, ...chart.y_fields]
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, i) => (
            <tr key={i}>
              {columns.map((column, c) => (
                <td key={column} className={c > 0 ? 'num' : undefined}>
                  {formatCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
