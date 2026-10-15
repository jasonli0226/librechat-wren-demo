// Downloads the embedding model and copies onnxruntime's wasm into <outDir>, so the browser
// loads both from the gallery and never contacts Hugging Face or a CDN.
// Usage: node scripts/fetch-model.mjs <outDir>   (dist for the image, public for `npm run dev`)
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const outDir = process.argv[2] ?? 'public'
const model = JSON.parse(await readFile(new URL('../src/semantic/model.json', import.meta.url), 'utf8'))

for (const file of model.files) {
  const target = join(outDir, 'models', model.id, file)
  if (await stat(target).then(() => true, () => false)) continue
  const url = `https://huggingface.co/${model.id}/resolve/main/${file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  console.log(`fetched ${model.id}/${file}`)
}

const candidates = [
  'node_modules/onnxruntime-web/dist',
  'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist',
]
const ortDir = (await Promise.all(candidates.map((dir) => stat(dir).then(() => dir, () => null)))).find(Boolean)
if (!ortDir) throw new Error('onnxruntime-web not found; run npm ci first')
await mkdir(join(outDir, 'ort'), { recursive: true })
const ortFiles = (await readdir(ortDir)).filter((name) => name.startsWith('ort-wasm') && /\.(wasm|mjs)$/.test(name))
if (ortFiles.length === 0) throw new Error(`no ort-wasm files in ${ortDir}`)
for (const name of ortFiles) await copyFile(join(ortDir, name), join(outDir, 'ort', name))
console.log(`copied ${ortFiles.length} onnxruntime files from ${ortDir}`)
