import { flushSync } from 'react-dom'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

/** Applies a layout change inside a View Transition when the browser supports it and motion is allowed. */
export function swapLayout(update: () => void): void {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  const transition = document.startViewTransition(() => flushSync(update))
  // A skipped transition rejects these; the layout still updates, so the rejection is noise.
  transition?.ready?.catch(() => {})
  transition?.finished?.catch(() => {})
}
