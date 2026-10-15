import type { Embedder } from 'semantic-state/worker'
import { describe, expect, it, vi } from 'vitest'
import { failOnce } from './failOnce'

describe('failOnce', () => {
  it('passes results through', async () => {
    const inner: Embedder = { embed: vi.fn(async () => [new Float32Array([1])]) }
    await expect(failOnce(inner).embed(['a'], () => {})).resolves.toEqual([new Float32Array([1])])
  })

  it('never calls the inner embedder again after a failure', async () => {
    const inner: Embedder = { embed: vi.fn(async () => Promise.reject(new Error('model blocked'))) }
    const embedder = failOnce(inner)
    await expect(embedder.embed(['a'], () => {})).rejects.toThrow('model blocked')
    await expect(embedder.embed(['b'], () => {})).rejects.toThrow('model blocked')
    expect(inner.embed).toHaveBeenCalledTimes(1)
  })
})
