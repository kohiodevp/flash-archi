// Trace the actual firings inside generateArchitecture
import { generateArchitecture } from '../src/engine.js'

const origFetch = globalThis.fetch

// Patch llm.js isn't trivial (module imports callLLM internally). Instead:
// Call generateArchitecture and, if facades empty, re-run facade branch manually.
const r = await generateArchitecture('villa 150m² 3 chambres')
console.log('RESULT facades:', JSON.stringify(r.facades))
const north = r.facades.north
console.log('north empty:', north === '')

// Now reconstruct the facade system that the engine builds and feed to the same mock
const facadesSystem =
  'Génère les 4 élévations (Nord, Sud, Est, Ouest) d’un bâtiment dont les spécifications sont fournies. ' +
  'Pour chaque façade, renvoie une image PNG encodée en base64. ' +
  'Formate ta réponse exactement comme suit, sans aucun texte supplémentaire :' +
  '\n---NORD---\n<base64>\n---SUD---\n<base64>\n---EST---\n<base64>\n---OUEST---\n<base64>'

// recreate what the mock would return
const mockFacades = `---NORD---
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
---SUD---
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
---EST---
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
---OUEST---
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=`

// Now parse with the engine's exact logic
const rawText = mockFacades.trim()
const parts = rawText.split(/---(NORD|SUD|EST|OUEST)---/)
const facadeMap = {}
for (let i = 1; i < parts.length; i += 2) {
  const raw = parts[i]
  const value = parts[i + 1]
  if (raw === undefined || value === undefined) continue
  facadeMap[raw.toLowerCase()] = value.trim()
}
console.log('engine-parse map:', JSON.stringify({ north: facadeMap.north?.length, south: facadeMap.south?.length }))