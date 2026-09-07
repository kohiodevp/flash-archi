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

export async function generateArchitecture(userPrompt, { onProgress } = {}) {
  const progress = (stage, percent) => { try { onProgress?.({ stage, percent }) } catch { /* best-effort */ } }

  // 1) Intention — LLM d'abord, fallback robuste (détection regex/mock).
  //    Un LLM local imparfait (JSON invalide) ne doit jamais casser la
  //    génération : on retombe sur une extraction déterministe.
  progress('Analyse du prompt…', 10)
  const intentSystem =
    'Tu es un assistant d’extraction de spécifications architecturales. ' +
    'Extrais notamment, si l’info est disponible : la surface (m²), le nombre de pièces, ' +
    'le style, le nombre d’étages (storeys) et la hauteur par étage (heightPerStorey, en mètres, défaut 3.0). ' +
    'Retourne uniquement un objet JSON conforme au schéma suivant : ' +
    JSON.stringify(FlashSpec.shape)

  const { mockIntentFn } = await import('./llm.js')
  const isConfigError = (msg) =>
    /provider inconnu|clé api manquante|provider échoué|inconnu|inexistant/i.test(msg ?? '')
  let spec
  try {
    const intentRaw = await llmCall(intentSystem, userPrompt)
    const specParse = FlashSpec.safeParse(JSON.parse(extractJson(intentRaw)))
    if (!specParse.success) throw new Error(specParse.error.message)
    spec = specParse.data
  } catch (intentErr) {
    // Ne JAMAIS masquer une erreur de configuration (provider inconnu,
    // clé manquante) derrière le fallback : c'est un signal d'infra.
    if (isConfigError(intentErr.message)) throw intentErr
    // Sinon (LLM local imparfait / JSON invalide) → extraction déterministe.
    console.warn(`[engine] intention LLM défaillante (${intentErr.message}) → fallback déterministe`)
    const fallback = mockIntentFn(userPrompt)
    const specParse = FlashSpec.safeParse(fallback)
    if (!specParse.success) throw new Error(`Échec d’extraction d’intention : ${specParse.error.message}`)
    spec = specParse.data
  }
  progress('Génération du plan 2D…', 30)

  // 2) Plan 2D — LLM d'abord, fallback paramétrique (plan-generator) si le
  //    plan LLM est absent, illisible ou trop sommaire (< 200 caractères).
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
  let plan2d
  try {
    const plan2dRaw = await llmCall(plan2dSystem, plan2dUser)
    const plan2dParse = FlashPlan2DOutput.safeParse(JSON.parse(extractJson(plan2dRaw)))
    if (!plan2dParse.success) throw new Error(plan2dParse.error.message)
    // Garde-fou : un plan LLM trop court est considéré invalide → fallback.
    if (!plan2dParse.data.svg || plan2dParse.data.svg.length < 200) {
      throw new Error('SVG du plan trop court (< 200 car.)')
    }
    plan2d = plan2dParse.data
  } catch (planErr) {
    const { buildPlan2D } = await import('./services/plan-generator.js')
    const gen = buildPlan2D(spec)
    console.warn(`[engine] plan LLM défaillant (${planErr.message}) → fallback paramétrique`)
    plan2d = gen
  }

  progress('Génération des façades…', 60)
  // 3) Façades (4 vues) — GÉNÉRATEUR PARAMÉTRIQUE (Option B).
  //    Remplaçant le mock 1×1 pixel : façades réalistes (murs, fenêtres,
  //    porte, toit) dérivées de la spec, déterministes, coût nul.
  //    Atomic : si un vrai LLM image est branché plus tard, on peut y re-router.
  const { generateAllFacades, completeSpec } = await import('./services/facade-generator.js')
  const facades = await generateAllFacades(completeSpec(spec))
  progress('Calcul des métriques BIM…', 82)

  // 4) Maquette IFC4 (Export BIM pour l'homologation)
  //    Déterministe (pas de LLM) : binaire IFC4 encodé en base64.
  //    Les ouvertures détectées dans le plan 2D sont portées dans l'IFC.
  const openings = detectOpenings(plan2d.svg)
  const ifcBytes = generateIfcModel(spec, openings)
  const ifcBase64 = Buffer.from(ifcBytes).toString('base64')
  const ifcModel = `data:application/step;base64,${ifcBase64}`
  progress('Finalisation…', 96)

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