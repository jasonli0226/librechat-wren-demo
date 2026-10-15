import type { SemanticSnapshot, SemanticStore } from 'semantic-state'
import { vi } from 'vitest'
import type { ChartSummary } from '../types'

export function createFakeStore(initial: Partial<SemanticSnapshot<ChartSummary>> = {}) {
  let snapshot: SemanticSnapshot<ChartSummary> = {
    status: 'ready',
    error: null,
    model: { status: 'ready', progress: 1, error: null },
    results: {},
    similar: {},
    weights: { text: 1, tables: 0.15 },
    lastEmbedMs: null,
    ...initial,
  }
  const listeners = new Set<() => void>()
  const store = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    upsert: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    interact: vi.fn(),
    forget: vi.fn(),
    clearInterests: vi.fn(),
    watch: vi.fn(() => () => {}),
    setWeights: vi.fn(),
    requestSimilar: vi.fn(),
    onEmbedded: vi.fn(() => () => {}),
    onQueryEmbedded: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } satisfies SemanticStore<ChartSummary>
  const update = (patch: Partial<SemanticSnapshot<ChartSummary>>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  return { store, update }
}
