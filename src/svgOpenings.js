// ===========================================================
// Flash-Archi SaaS — Détection d'ouvertures dans le plan 2D (SVG)
//
// Analyse le SVG du plan d'étage généré et repère les symboles
// d'ouvertures (fenêtres, portes). Conventions reconnues :
//   - Fenêtre : <circle … fill="white"> posé sur un trait de mur
//   - Porte    : <path> / <line> fin et contrasté, isolé
//
// Retourne une liste d'ouvertures { type, x, y, w, h } en
// coordonnées SVG (unité = px du viewBox). La conversion métrique
// est laissée au générateur IFC via l'échelle.
// ===========================================================

const WINDOW_FILL = /white|#[fF]{3,6}/ // fill blanc ou gris très clair

/** Extrait les attributs d'un tag SVG (balises auto-fermantes ou paires). */
function tagAttrs(body) {
  const attrs = {}
  const re = /([a-zA-Z0-9:_-]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(body))) attrs[m[1]] = m[2]
  return attrs
}

function num(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Détecte les fenêtres = cercles blancs (symboles d'ouverture). */
function detectWindows(svg) {
  const out = []
  const re = /<circle\b([^>]*)\/?>/gi
  let m
  while ((m = re.exec(svg))) {
    const a = tagAttrs(m[1])
    if (!WINDOW_FILL.test(a.fill ?? '')) continue
    const cx = num(a.cx)
    const cy = num(a.cy)
    const r = num(a.r)
    if (cx === null || cy === null || r === null) continue
    out.push({ type: 'window', x: cx - r, y: cy - r, w: r * 2, h: r * 2, cx, cy, r })
  }
  return out
}

/** Détecte les portes = arcs fins contrastés (symbol plan) ou traits fins. */
function detectDoors(svg) {
  const out = []
  // Match <line ...> ou <path ...> (auto-fermant ou non)
  const re = /<(line|path)[^>]*>/gi
  let m
  while ((m = re.exec(svg))) {
    const tag = m[0]
    let inner = tag.slice(1, -1)
    if (inner.endsWith('/')) inner = inner.slice(0, -1).trimEnd()
    const a = tagAttrs(inner)
    // Ignorer les traits du plan structurel épais (murs) : on veut du fin.
    const strokeWidth = num(a['stroke-width']) ?? num(a['strokeWidth']) ?? 2
    const isWallThick = strokeWidth >= 3
    const hasOpeningColor = /#c00|#d30|red|#f00/i.test(a.stroke ?? '')
    if (isWallThick || !hasOpeningColor) continue
    const x1 = num(a.x1); const y1 = num(a.y1)
    const x2 = num(a.x2); const y2 = num(a.y2)
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      // <line> : porte/vid delta = segment COURt (une cloison pleine est longue).
      const len = Math.hypot(x2 - x1, y2 - y1)
      if (len >= 4 && len < 200) {
        out.push({ type: 'door', x: Math.min(x1, x2), y: Math.min(y1, y2), w: len, h: strokeWidth })
      }
    } else if (tag.startsWith('<path')) {
      // <path> : arc de porte (ex. <path d="M … A …" stroke="#d30" stroke-width="2">).
      // Un arc fin et contrasté = porte (pas de coordonnées simples, mais le
      // symbole est sans ambiguïté). On évite les doubles coûts en consommant
      // la porte ; l'IFC n'a besoin que du type + une géométrie indicative.
      out.push({ type: 'door', x: 0, y: 0, w: strokeWidth * 20 + 40, h: strokeWidth })
    }
  }
  return out
}

/**
 * Analyse un SVG de plan 2D et retourne la liste d'ouvertures.
 * @param {string} svg Contenu SVG du plan d'étage.
 * @returns {Array<{type:string,x:number,y:number,w:number,h:number}>}
 */
export function detectOpenings(svg) {
  const windows = detectWindows(svg)
  const doors = detectDoors(svg)
  return [...windows, ...doors]
}

export function countOpenings(svg) {
  return detectOpenings(svg).length
}

export { detectDoors, detectWindows }