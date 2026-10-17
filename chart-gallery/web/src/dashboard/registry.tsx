import { defineRegistry } from '@json-render/react'
import { catalog } from './catalog'
import { BarTile, LineTile, StackedBarTile, StatTile, TableTile } from './tiles'

export const { registry } = defineRegistry(catalog, {
  components: {
    Dashboard: ({ props, children }) => (
      <div className="dashboard">
        {props.summary ? (
          <p className="dashboard-summary">
            <span className="ai-label">AI summary</span>
            <span>{props.summary}</span>
          </p>
        ) : null}
        {children}
      </div>
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
    StackedBarTile: ({ props }) => <StackedBarTile chartId={props.chartId} width={props.width} />,
    TableTile: ({ props }) => <TableTile chartId={props.chartId} width={props.width} />,
  },
})
