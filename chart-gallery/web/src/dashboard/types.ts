import type { ChartDetail } from '../types'

export type TileType = 'stat' | 'line' | 'bar' | 'stackedBar' | 'table'
export type TileWidth = 'quarter' | 'half' | 'full'

export interface TilePlan {
  chart: ChartDetail
  type: TileType
  allowed: readonly TileType[]
  confidence: number | null
}

export type Headlines = Readonly<Record<string, Readonly<Record<string, number | string>>>>

export type Row = Readonly<Record<string, unknown>>
