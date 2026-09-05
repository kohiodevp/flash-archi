// ===========================================================
// Flash-Archi SaaS — Moteur de génération
// Port de la logique du plugin host (flashArchiHandler) :
//   1) Extraction d'intention (spec)      -> FlashSpec
//   2) Génération plan 2D (SVG)           -> Plan2D
//   3) Génération 4 façades (PNG b64)     -> Facades
// ===========================================================
import { FlashSpec, FlashPlan2DOutput, FlashFacadeOutput, FlashArchiResult } from './schemas.js'
import { config } from './config.js'
import { callLLM, ACTIVE_PROVIDER, ACTIVE_MODEL } from './llm.js'
import { makeCacheKey } from './cache.js'
import { cache } from './cache.js'
import { generateIfcModel } from './ifcGenerator.js'
import { detectOpenings } from './svgOpenings.js'

/** Extrait le premier objet JSON équilibré d'un texte libre. */
function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return text.trim()
  return text.slice(start, end + 1)
}

async function llmCall(system, userText) {
  const key = makeCacheKey(ACTIVE_PROVIDER, ACTIVE_MODEL, system, userText)
  const cached = await cache.get(key)
  if (cached !== null) return cached
  const text = await callLLM({ system, user: userText })
  await cache.set(key, text)
  return text
}

export async function generateArchitecture(userPrompt) {
  // 1) Intention
  const intentSystem =
    'Tu es un assistant d’extraction de spécifications architecturales. ' +
    'Extrais notamment, si l’info est disponible : la surface (m²), le nombre de pièces, ' +
    'le style, le nombre d’étages (storeys) et la hauteur par étage (heightPerStorey, en mètres, défaut 3.0). ' +
    'Retourne uniquement un objet JSON conforme au schéma suivant : ' +
    JSON.stringify(FlashSpec.shape)
  const intentRaw = await llmCall(intentSystem, userPrompt)
  const specParse = FlashSpec.safeParse(JSON.parse(extractJson(intentRaw)))
  if (!specParse.success) {
    throw new Error(`Échec d’extraction d’intention : ${specParse.error.message}`)
  }
  const spec = specParse.data

  // 2) Plan 2D
  const plan2dSystem =
    'Tu es un architecte technique. À partir des spécifications suivantes, génère un plan d’étage 2D au format SVG. ' +
    'Inclus murs, portes, fenêtres, dimensions, légende, orientation Nord et échelle 1/50. ' +
    'Réponds uniquement avec un objet JSON contenant les champs : { "svg": "<svg>…</svg>", "scale": 50, "legend": "..." }. ' +
    'Aucun texte supplémentaire.'
  const plan2dUser = `
    Surface : ${spec.surface} m²
    Chambres : ${spec.rooms}
    Style : ${spec.style ?? 'non précisé'}
    Toit : ${spec.roof ?? 'non précisé'}
    Couleurs façade/volets : ${spec.facadeColor ?? 'non précisé'} / ${spec.shutterColor ?? 'non précisé'}
    Garage : ${spec.garage ?? 'aucun'}
  `
  const plan2dRaw = await llmCall(plan2dSystem, plan2dUser)
  const plan2dParse = FlashPlan2DOutput.safeParse(JSON.parse(extractJson(plan2dRaw)))
  if (!plan2dParse.success) {
    throw new Error(`Échec de génération du plan 2D : ${plan2dParse.error.message}`)
  }
  const plan2d = plan2dParse.data

  // 3) Façades (4 vues)
  const facadesSystem =
    'Génère les 4 élévations (Nord, Sud, Est, Ouest) d’un bâtiment dont les spécifications sont fournies. ' +
    'Pour chaque façade, renvoie une image PNG encodée en base64. ' +
    'Formate ta réponse exactement comme suit, sans aucun texte supplémentaire :' +
    '\n---NORD---\n<base64>\n---SUD---\n<base64>\n---EST---\n<base64>\n---OUEST---\n<base64>'
  const facadesRaw = await llmCall(facadesSystem, JSON.stringify(spec))
  const rawText = facadesRaw.trim()
  const parts = rawText.split(/---(NORD|SUD|EST|OUEST)---/)
  const FACADE_KEY = { NORD: 'north', SUD: 'south', EST: 'east', OUEST: 'west' }
  const facadeMap = {}
  for (let i = 1; i < parts.length; i += 2) {
    const raw = parts[i]
    const value = parts[i + 1]
    if (raw === undefined || value === undefined) continue
    const key = FACADE_KEY[raw.toUpperCase()] ?? raw.toLowerCase()
    if (value.trim()) facadeMap[key] = value.trim()
  }
  const facadeObj = {
    north: facadeMap.north ?? '',
    south: facadeMap.south ?? '',
    east: facadeMap.east ?? '',
    west: facadeMap.west ?? '',
  }
  const facadesParse = FlashFacadeOutput.safeParse(facadeObj)
  if (!facadesParse.success) {
    throw new Error(`Échec de génération des façades : ${facadesParse.error.message}`)
  }
  const facades = facadesParse.data

  // 4) Maquette IFC4 (Export BIM pour l'homologation)
  //    Déterministe (pas de LLM) : binaire IFC4 encodé en base64.
  //    Les ouvertures détectées dans le plan 2D sont portées dans l'IFC.
  const openings = detectOpenings(plan2d.svg)
  const ifcBytes = generateIfcModel(spec, openings)
  const ifcBase64 = Buffer.from(ifcBytes).toString('base64')
  const ifcModel = `data:application/step;base64,${ifcBase64}`

  // 5) Métriques BIM dérivées (empreinte, volume, ouvertures réelles)
  const footprintArea = spec.surface
  const grossVolume = footprintArea * spec.storeys * spec.heightPerStorey
  const openingCount = openings.length
  const ROOF_T = 0.25
  const roofArea = spec.surface
  const totalVolume = grossVolume + (roofArea * ROOF_T)

  const result = { spec, plan2d, facades, ifcModel, bimMetrics: { footprintArea, grossVolume, openingCount, roofArea, totalVolume } }
  const resultParse = FlashArchiResult.safeParse(result)
  if (!resultParse.success) {
    throw new Error(`Résultat global invalide : ${resultParse.error.message}`)
  }
  return resultParse.data
}

export const ENGINE = {
  provider: ACTIVE_PROVIDER,
  model: ACTIVE_MODEL,
  maxTokens: config.llm.maxTokens,
  temperature: config.llm.temperature,
}