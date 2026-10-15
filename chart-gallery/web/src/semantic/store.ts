import { createSemanticStore } from 'semantic-state'
import type { ChartSummary } from '../types'

export const chartStore = createSemanticStore<ChartSummary>(
  new Worker(new URL('./charts.worker.ts', import.meta.url), { type: 'module' }),
)
