import { callLLM } from '../src/llm.js'
import { makeCacheKey } from '../src/cache.js'
import { cache } from '../src/cache.js'

// The exact facadesSystem used in engine.js
const facadesSystem =
  'Génère les 4 élévations (Nord, Sud, Est, Ouest) d’un bâtiment dont les spécifications sont fournies. ' +
  'Pour chaque façade, renvoie une image PNG encodée en base64. ' +
  'Formate ta réponse exactement comme suit, sans aucun texte supplémentaire :' +
  '\n---NORD---\n<base64>\n---SUD---\n<base64>\n---EST---\n<base64>\n---OUEST---\n<base64>'

console.log('system has élévation:', facadesSystem.includes('élévation'))
console.log('system has plan 2D:', facadesSystem.includes('plan 2D'))
console.log('system has plan d’étage:', facadesSystem.includes('plan d’étage'))

const key = makeCacheKey('mock', 'gpt-4o', facadesSystem, '{}')
console.log('cache hit before:', await cache.get(key))

const out = await callLLM({ system: facadesSystem, user: '{}' })
console.log('OUT len:', out.length)
console.log('OUT head:', JSON.stringify(out.slice(0, 60)))