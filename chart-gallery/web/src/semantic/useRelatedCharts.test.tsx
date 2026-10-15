import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { similarKey } from 'semantic-state'
import { SemanticProvider } from 'semantic-state/react'
import { describe, expect, it } from 'vitest'
import { createFakeStore } from '../test/fakeStore'
import { SUMMARIES } from '../test/fixtures'
import { useRelatedCharts } from './useRelatedCharts'

describe('useRelatedCharts', () => {
  it('shows the table-overlap fallback until the worker answers', () => {
    const { store, update } = createFakeStore({ model: { status: 'loading', progress: 0.3, error: null } })
    const wrapper = ({ children }: { children: ReactNode }) => <SemanticProvider store={store}>{children}</SemanticProvider>
    const { result } = renderHook(() => useRelatedCharts(SUMMARIES[1], SUMMARIES), { wrapper })

    expect(store.requestSimilar).toHaveBeenCalledWith(2, 5)
    expect(result.current.refining).toBe(true)
    expect(result.current.rows.map((r) => r.id)).toEqual([1]) // shares "stores"

    const answer = { id: 3, item: SUMMARIES[2], score: 0.4, confidence: 0.4, reason: { kind: 'interest' as const, becauseOf: 2 } }
    act(() => update({ model: { status: 'ready', progress: 1, error: null }, similar: { [similarKey(2, 5)]: [answer] } }))

    expect(result.current.refining).toBe(false)
    expect(result.current.modelStatus).toBe('ready')
    expect(result.current.rows).toEqual([answer])
  })
})
