// src/hermesPolicy.js
// Politique de sécurité d'exécution des outils Hermes.
// Principe : DENY BY DEFAULT.
// Seuls les outils explicitement listés dans HERMES_ALLOWED_TOOLS (CSV) sont autorisés.
// Si la config est absente ou invalide => refus (fail-closed).

const DEFAULT_ALLOWED = () => {
  const raw = process.env.HERMES_ALLOWED_TOOLS || '';
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
};

function isToolAllowed(toolName) {
  const denyAll = (process.env.HERMES_DENY_ALL_BY_DEFAULT || 'true') === 'true';
  const name = String(toolName || '').toLowerCase();
  if (!name) return false;
  // Fail-closed: si deny-all et pas dans la liste -> refus.
  if (denyAll) {
    return DEFAULT_ALLOWED().includes(name);
  }
  // Mode non deny-all par défaut : on autorise tout sauf ce qui est dans une liste de refus.
  const denied = (process.env.HERMES_DENIED_TOOLS || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return !denied.includes(name);
}

export default { isToolAllowed };