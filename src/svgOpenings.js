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

/** Détecte les portes = traits fins contrastés (lignes isolées). */
function detectDoors(svg) {
  const out = []
  // Match <line ...> or <path ...> (self-closing or not)
  const re = /<(line|path)[^>]*>/gi
  let m
  while ((m = re.exec(svg))) {
    const tag = m[0] // e.g. "<line x1=\"1\" y1=\"2\" x2=\"3\" y2=\"4\" stroke=\"#d30\"/>"
    // Remove the leading '<' and trailing '>' (maybe '/>' ) to get the inner
    let inner = tag.slice(1, -1)
    if (inner.endsWith('/')) inner = inner.slice(0, -1).trimEnd()
    const a = tagAttrs(inner)
    // Ignorer les traits du plan structurel épais (murs) : on veut du fin.
    const strokeWidth = num(a['stroke-width']) ?? num(a['strokeWidth']) ?? 2
    const isWallThick = strokeWidth >= 3
    const hasOpeningColor = /#c00|#d30|red|#f00/i.test(a.stroke ?? '')
    if (isWallThick || !hasOpeningColor) continue
    // Porte/vid delta : segment COURt (une cloison pleine est longue).
    const x1 = num(a.x1); const y1 = num(a.y1)
    const x2 = num(a.x2); const y2 = num(a.y2)
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      const len = Math.hypot(x2 - x1, y2 - y1)
      if (len >= 4 && len < 200) {
        out.push({ type: 'door', x: Math.min(x1, x2), y: Math.min(y1, y2), w: len, h: strokeWidth })
      }
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