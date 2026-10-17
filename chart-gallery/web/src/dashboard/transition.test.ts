import { afterEach, describe, expect, it, vi } from 'vitest'
import { swapLayout } from './transition'

// jsdom has no View Transitions; install a stand-in on the document.
function stubStartViewTransition(fn: (cb: () => void) => void) {
  Object.defineProperty(document, 'startViewTransition', { value: fn, configurable: true })
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('swapLayout', () => {
  it('uses startViewTransition when available', () => {
    stubReducedMotion(false)
    const start = vi.fn((cb: () => void) => cb())
    stubStartViewTransition(start)
    const update = vi.fn()
    swapLayout(update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('calls update directly with reduced motion', () => {
    stubReducedMotion(true)
    const start = vi.fn()
    stubStartViewTransition(start)
    const update = vi.fn()
    swapLayout(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('calls update directly without the API', () => {
    stubReducedMotion(false)
    const update = vi.fn()
    swapLayout(update)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
