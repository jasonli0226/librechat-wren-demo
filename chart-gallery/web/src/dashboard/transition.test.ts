import { afterEach, describe, expect, it, vi } from 'vitest'
import { swapLayout } from './transition'

// jsdom has no View Transitions; install a stand-in on the document.
function stubStartViewTransition(fn: (cb: () => void) => unknown) {
  Object.defineProperty(document, 'startViewTransition', { value: fn, configurable: true })
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('does not leave a rejected ready promise unhandled', async () => {
    stubReducedMotion(false)
    stubStartViewTransition((cb: () => void) => {
      cb()
      return {
        ready: Promise.reject(new DOMException('skipped', 'AbortError')),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      }
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const update = vi.fn()
      swapLayout(update)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(update).toHaveBeenCalledTimes(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
