// Minimal reproduction of the engine's facade parse.
// The mock OUTPUT is what callLLM returns through the engine's llmCall.
import { callLLM } from '../src/llm.js'

// Exact engine facadesSystem:
const facadesSystem =
  'Génère les 4 élévations (Nord, Sud, Est, Ouest) d’un bâtiment dont les spécifications sont fournies. ' +
  'Pour chaque façade, renvoie une image PNG encodée en base64. ' +
  'Formate ta réponse exactement comme suit, sans aucun texte supplémentaire :' +
  '\n---NORD---\n<base64>\n---SUD---\n<base64>\n---EST---\n<base64>\n---OUEST---\n<base64>\n'

const out = await callLLM({ system: facadesSystem, user: '{"surface":150}' })
console.log('CALL-LLM OUT len:', out.length)
console.log('OUT head:', JSON.stringify(out.slice(0, 50)))
const rawText = out.trim()
const parts = rawText.split(/---(NORD|SUD|EST|OUEST)---/)
console.log('parts.len:', parts.length)
for (let i = 1; i < parts.length; i += 2) {
  console.log('  part', i, '=', JSON.stringify(parts[i]), '-> value len', parts[i + 1]?.trim().length)
}