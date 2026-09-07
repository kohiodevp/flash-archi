// ===========================================================
// Flash-Archi SaaS — LLM Provider (API publique de génération)
//
// Façade unifiée : `generate(prompt)` produit une architecture
// complète (spec + plan 2D + 4 façades + IFC + BIM), en déléguant
// le choix du provider à la couche configurée (mock | ollama |
// seekai | openrouter | groq) dans src/llm.js.
//
// NB : la couche bas niveau (gestion providers, fallbacks, cache TTL)
// vit dans src/llm.js — ce module expose l'API haut niveau attendue
// par les callers (services/webhooks) et force une spec complète.
// ===========================================================
import { generateArchitecture } from '../engine.js'
import { callLLM, ACTIVE_PROVIDER, ACTIVE_MODEL } from '../llm.js'
import { config } from '../config.js'

export class LLMProvider {
  constructor() {
    this.provider = ACTIVE_PROVIDER
    this.model = ACTIVE_MODEL
  }

  get info() {
    return {
      provider: ACTIVE_PROVIDER,
      model: ACTIVE_MODEL,
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
    }
  }

  /**
   * Génère une architecture complète à partir d'un prompt utilisateur.
   * @param {string} prompt
   * @returns {Promise<{spec, plan2d, facades, ifcModel, bimMetrics}>}
   */
  async generate(prompt) {
    return generateArchitecture(prompt)
  }

  /** Accès brut bas niveau (pour les callers qui veulent le texte LLM). */
  async generateText({ system, user }) {
    return callLLM({ system, user })
  }
}

/** Instance partagée (singleton). */
export const llmProvider = new LLMProvider()