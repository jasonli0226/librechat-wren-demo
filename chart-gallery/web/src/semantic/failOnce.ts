import type { Embedder } from 'semantic-state/worker'

/**
 * After the first failure (e.g. model files missing), every later call fails at once.
 * semantic-state's transformers embedder would otherwise retry the download on the next batch.
 */
export function failOnce(inner: Embedder): Embedder {
  let failure: unknown = null
  return {
    async embed(texts, onProgress) {
      if (failure !== null) throw failure
      try {
        return await inner.embed(texts, onProgress)
      } catch (error) {
        failure = error
        throw error
      }
    },
  }
}
