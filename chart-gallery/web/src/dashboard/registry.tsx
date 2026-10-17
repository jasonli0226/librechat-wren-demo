import { defineRegistry } from '@json-render/react'
import { catalog } from './catalog'
import { BarTile, LineTile, ScatterTile, StackedBarTile, StatTile, TableTile } from './tiles'

export const { registry } = defineRegistry(catalog, {
  components: {
    Dashboard: ({ children }) => <div className="dashboard">{children}</div>,
    Hero: ({ children }) => <div className="tile-grid dashboard-hero">{children}</div>,
    Insights: ({ props }) => (
      <aside className="insights">
        <span className="ai-label">AI insights</span>
        <ul>
          {props.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </aside>
    ),
    Section: ({ props, children }) => (
      <section className="dashboard-section">
        {props.title ? <h2 className="section-title">{props.title}</h2> : null}
        <div className="tile-grid">{children}</div>
      </section>
    ),
    StatTile: ({ props }) => <StatTile chartId={props.chartId} width={props.width} />,
    LineTile: ({ props }) => <LineTile chartId={props.chartId} width={props.width} />,
    BarTile: ({ props }) => <BarTile chartId={props.chartId} width={props.width} />,
    ScatterTile: ({ props }) => <ScatterTile chartId={props.chartId} width={props.width} />,
    StackedBarTile: ({ props }) => <StackedBarTile chartId={props.chartId} width={props.width} />,
    TableTile: ({ props }) => <TableTile chartId={props.chartId} width={props.width} />,
  },
})
