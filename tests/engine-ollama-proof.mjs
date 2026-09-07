#!/usr/bin/env node
// Test de génération complète avec provider Ollama réel.
process.env.LLM_PROVIDER = 'ollama'
process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
process.env.LLM_MODEL = 'qwen2.5:3b-instruct'

const t0 = Date.now()
// On importe dynamiquement l'engine APRÈS avoir fixé les env (config les lit à l'import).
const { generateArchitecture } = await import('../src/engine.js')

console.log('Provider ollama → génération en cours (peut prendre 1-2 min)...')
const result = await generateArchitecture('une villa de 120 m² avec 4 chambres, style contemporain, 2 étages, garage simple')

console.log(`Durée totale: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('=== SPEC ===', JSON.stringify(result.spec))
console.log('=== FACADES ===')
for (const [k, v] of Object.entries(result.facades)) {
  const bytes = v && v.includes(',') ? Buffer.from(v.split(',')[1], 'base64').length : 0
  console.log(`${k}: ${bytes} bytes PNG`)
}
console.log('=== PLAN ===')
console.log('SVG length:', result.plan2d.svg.length, '| legend:', result.plan2d.legend)
console.log('=== BIM ===', JSON.stringify(result.bimMetrics))

if (result.facades.north && Buffer.from(result.facades.north.split(',')[1], 'base64').length > 1000) {
  console.log('✅ FACADES RÉALISTES (générées par le moteur paramétrique — plus de mock 1px)')
}
if (result.spec.surface > 0 && result.spec.rooms > 0) {
  console.log('✅ SPEC EXTRACTÉE (LLM ou fallback)')
}