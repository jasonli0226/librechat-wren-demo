import { env } from '@huggingface/transformers'
import { transformersEmbedder } from 'semantic-state/transformers'
import { defineSemanticWorker } from 'semantic-state/worker'
import type { ChartSummary } from '../types'
import { failOnce } from './failOnce'
import { EMBED_MODEL, TABLE_WEIGHT, chartText, tableFeatures } from './features'

// The gallery serves the model and the onnxruntime wasm itself: no request leaves for a CDN.
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
const wasm = env.backends.onnx.wasm
if (wasm) wasm.wasmPaths = '/ort/'

defineSemanticWorker<ChartSummary>({
  id: (chart) => chart.id,
  text: chartText,
  embedder: failOnce(transformersEmbedder({ model: EMBED_MODEL })),
  features: tableFeatures,
  weights: { text: 1, tables: TABLE_WEIGHT },
  interests: { mode: 'multi' },
})
