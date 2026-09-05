import { callLLM } from '../src/llm.js'

const sys =
  "Génère les 4 élévations (Nord, Sud, Est, Ouest) d'un bâtiment dont les spécifications sont fournies. " +
  'Pour chaque façade, renvoie une image PNG encodée en base64. ' +
  'Formate ta réponse exactement comme suit, sans aucun texte supplémentaire :' +
  '\n---NORD---\n<base64>\n---SUD---\n<base64>\n---EST---\n<base64>\n---OUEST---\n<base64>'

console.log('has élévation:', sys.includes('élévation'))
console.log('has élévations:', sys.includes('élévations'))
console.log('has façade:', sys.includes('façade'))

const out = await callLLM({ system: sys, user: '{}' })
console.log('OUT:', JSON.stringify(out))
const parts = out.split(/---(NORD|SUD|EST|OUEST)---/)
console.log('PARTS:', JSON.stringify(parts))
const map = {}
for (let i = 1; i < parts.length; i += 2) {
  const raw = parts[i]
  const value = parts[i + 1]
  if (raw === undefined || value === undefined) continue
  map[raw.toLowerCase()] = value.trim()
}
console.log('MAP:', JSON.stringify(map))