import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import type { TileType } from './types'

export const INSIGHT_MAX = 120
export const MAX_BULLETS = 5
export const TITLE_MAX = 60

const tileProps = z.object({
  chartId: z.number().int().positive(),
  width: z.enum(['quarter', 'half', 'full']),
})

const tile = (description: string) => ({ props: tileProps, description })

export const catalog = defineCatalog(schema, {
  components: {
    Dashboard: {
      props: z.object({}),
      slots: ['default'],
      description: 'Dashboard root; children are one Hero then Sections',
    },
    Hero: {
      props: z.object({}),
      slots: ['default'],
      description: 'Main tile, optionally followed by Insights',
    },
    Insights: {
      props: z.object({ bullets: z.array(z.string().max(INSIGHT_MAX)).min(1).max(MAX_BULLETS) }),
      description: 'Short AI bullet points citing headline numbers',
    },
    Section: {
      props: z.object({ title: z.string().max(TITLE_MAX) }),
      slots: ['default'],
      description: 'Titled group of tiles',
    },
    StatTile: tile('Single headline number for a chart'),
    LineTile: tile('Line chart'),
    BarTile: tile('Bar chart'),
    ScatterTile: tile('Scatter chart'),
    StackedBarTile: tile('Stacked bar chart'),
    TableTile: tile('Data table'),
  },
  actions: {},
})

export const TILE_COMPONENT: Record<TileType, string> = {
  stat: 'StatTile',
  line: 'LineTile',
  bar: 'BarTile',
  scatter: 'ScatterTile',
  stackedBar: 'StackedBarTile',
  table: 'TableTile',
}
