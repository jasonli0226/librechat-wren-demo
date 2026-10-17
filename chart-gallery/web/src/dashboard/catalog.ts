import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import type { TileType } from './types'

export const SUMMARY_MAX = 200
export const TITLE_MAX = 60

const tileProps = z.object({
  chartId: z.number().int().positive(),
  width: z.enum(['quarter', 'half', 'full']),
})

const tile = (description: string) => ({ props: tileProps, description })

export const catalog = defineCatalog(schema, {
  components: {
    Dashboard: {
      props: z.object({ summary: z.string().max(SUMMARY_MAX) }),
      slots: ['default'],
      description: 'Dashboard root with a one-line summary; children are Sections',
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
