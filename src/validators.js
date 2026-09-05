// ===========================================================
// Flash-Archi SaaS — Validation stricte du prompt
// Garde anti-prompt-injection : refuse les prompts qui tentent
// de court-circuiter les instructions système du moteur.
// ===========================================================
import { GenerateRequestSchema } from './schemas.js'

// Marqueurs typiques d'injection directe. Liste conservatrice :
// si un prompt revendique un rôle système ou demande un
// dépassement des consignes, on le refuse.
const INJECTION_PATTERNS = [
  /\bignore\s+(above|(all\s+)?previous|prior)\s+instructions\b/i,
  /\bdisregard\s+(above|(all\s+)?previous|prior|your)\s+(instructions|rules|prompt)\b/i,
  /\byou\s+are\s+now\s+(an?\s+)?(unconstrained|free|no longer)\b/i,
  /\bact\s+as\s+an?\s+unconstrained\s+llm\b/i,
]

/**
 * Valide le corps de requête et le prompt.
 * @returns {{ ok: true, data: { prompt: string } } |
 *            { ok: false, error: string, details?: unknown }}
 */
export function validateGenerateRequest(body) {
  const parse = GenerateRequestSchema.safeParse(body ?? {})
  if (!parse.success) {
    return { ok: false, error: 'Invalid request', details: parse.error.format() }
  }
  const { prompt } = parse.data
  for (const re of INJECTION_PATTERNS) {
    if (re.test(prompt)) {
      return { ok: false, error: 'Prompt rejected (injection guard)' }
    }
  }
  return { ok: true, data: { prompt } }
}