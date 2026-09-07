// ===========================================================
// Flash-Archi SaaS — Couche providers LLM
// openrouter | groq | ollama | mock
// "mock" = moteur déterministe local, aucune clé requise.
// ===========================================================
import { config } from './config.js'

function assertKey(name, value) {
  if (!value) {
    throw new Error(`Clé API manquante pour le provider sélectionné : ${name}. Configurez-la dans .env`)
  }
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, system, user, maxTokens, temperature }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Provider HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Réponse LLM vide ou inattendue')
  return text.trim()
}

async function callOllama({ baseUrl, model, system, user }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = await res.json()
  if (typeof data?.message?.content !== 'string') throw new Error('Réponse Ollama invalide')
  return data.message.content.trim()
}

/**
 * Moteur local "mock" : produit une spécification structurée déterministe
 * depuis le prompt, permettant d'opérer le SaaS sans aucun compte LLM.
 */
function mockIntent(text) {
  const mSurface = text.match(/(\d{2,4})\s*m²/)
  const mRooms = text.match(/(\d{1,2})\s*(?:chambre|pièce|chambres|pièces)/i)
  const style = /\b(?:méditerranéen|mediterraneen|contemporain|moderne|provençal|tropical|colonial)\b/i.exec(text)?.[0]?.toLowerCase() ?? 'contemporain'
  const hasGarage = /\b(?:garage|voiture|parking)\b/i.test(text)
  return {
    surface: mSurface ? Number(mSurface[1]) : 120,
    rooms: mRooms ? Number(mRooms[1]) : 3,
    hasOpenKitchen: /\b(?:open\s*space|cuisine\s*ouverte|kitchenette)\b/i.test(text),
    garage: hasGarage ? 'single' : 'none',
    style,
    roof: /\b(?:toit|tuiles?|tôle)\b/i.test(text) ? 'tuiles bac acier' : undefined,
    facadeColor: 'blanc',
    shutterColor: 'bleu',
  }
}
export const mockIntentFn = mockIntent

async function callSeekai({ baseUrl, apiKey, model, system, user, temperature }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
    }),
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Provider HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Réponse Seekai vide ou inattendue')
  return text.trim()
}

async function callMock({ system, user }) {
  if (system.includes("extraction de spécifications")) {
    return JSON.stringify(mockIntent(user))
  }
  if (system.includes('plan d’étage') || system.includes('plan d’etage') || system.includes('plan 2D')) {
    return JSON.stringify({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect x="20" y="20" width="560" height="360" fill="none" stroke="#1d1d1b" stroke-width="4"/><rect x="140" y="120" width="300" height="160" fill="none" stroke="#1d1d1b" stroke-width="4"/><line x1="140" y1="200" x2="440" y2="200" stroke="#d30"/><circle cx="420" cy="200" r="8" fill="white" stroke="#d30" stroke-width="2"/><line x1="330" y1="200" x2="330" y2="120" stroke="#c00" stroke-width="2" stroke-dasharray="4 3"/><text x="340" y="300" font-size="12">1/50</text></svg>',
      scale: 50,
      legend: 'Murs 20cm — Ouvertures — Échelle 1/50',
    })
  }
  if (system.includes('élévation') || system.includes('façade')) {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    return `---NORD---\n${base64}\n---SUD---\n${base64}\n---EST---\n${base64}\n---OUEST---\n${base64}`
  }
  throw new Error('Appel mock non géré (système inconnu)')
}

const dispatcher = {
  async openrouter(call) {
    assertKey('OPENROUTER_API_KEY', config.providers.openrouter.apiKey)
    return callOpenAiCompatible({
      baseUrl: config.providers.openrouter.baseUrl,
      apiKey: config.providers.openrouter.apiKey,
      model: config.providers.openrouter.textModel,
      ...call,
    })
  },
  async groq(call) {
    assertKey('GROQ_API_KEY', config.providers.groq.apiKey)
    return callOpenAiCompatible({
      baseUrl: config.providers.groq.baseUrl,
      apiKey: config.providers.groq.apiKey,
      model: config.providers.groq.textModel,
      ...call,
    })
  },
  async ollama(call) {
    return callOllama({
      baseUrl: config.providers.ollama.baseUrl,
      model: config.providers.ollama.fallbackModel,
      ...call,
    })
  },
  async seekai(call) {
    assertKey('SEEKAI_API_KEY', config.providers.seekai.apiKey)
    return callSeekai({
      baseUrl: config.providers.seekai.baseUrl,
      apiKey: config.providers.seekai.apiKey,
      model: config.providers.seekai.textModel,
      temperature: config.providers.seekai.temperature,
      ...call,
    })
  },
  async mock({ system, user }) {
    return callMock({ system, user })
  },
}

export async function callLLM({ system, user }) {
  const providerName = config.llm.provider
  const provider = dispatcher[providerName]
  if (!provider) throw new Error(`Provider inconnu : ${providerName}`)
  try {
    return await provider({ system, user })
  } catch (providerError) {
    // Fallback vers Ollama uniquement depuis un provider cloud (openrouter/groq).
    const isCloud = providerName === 'openrouter' || providerName === 'groq' || providerName === 'seekai'
    if (!isCloud) throw providerError
    return await callOllama({
      baseUrl: config.providers.ollama.baseUrl,
      model: config.providers.ollama.fallbackModel,
      system,
      user,
    }).catch((fallbackError) => {
      throw new Error(`Provider ${providerName} échoué ; fallback Ollama échoué aussi : ${providerError.message} / ${fallbackError.message}`)
    })
  }
}

export const ACTIVE_PROVIDER = config.llm.provider
export const ACTIVE_MODEL = config.llm.model