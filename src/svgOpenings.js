// ===========================================================
// Flash-Archi SaaS — Détection d'ouvertures dans le plan 2D (SVG)
//
// Analyse le SVG du plan d'étage généré et repère les symboles
// d'ouvertures (fenêtres, portes).
//
// Conventions reconnues (coexistence ancien/nouveau générateur) :
//   - Fenêtre (plan paramétrique v2) : <rect class="window">  fill #e3f2fd
//   - Fenêtre (ancien)               : <circle fill="white">
//   - Porte (plan v2)                : <path class="door"> / <line class="door">
//                                       stroke #8b4513 (arc d'entrée)
//   - Porte (ancien)                 : <line>/<path> fin rouge (#c00|#d30)
//
// Retourne une liste d'ouvertures { type, x, y, w, h } en
// coordonnées SVG (px du viewBox). La conversion métrique est
// laissée au générateur IFC via l'échelle.
// ===========================================================

const WINDOW_FILL = /white|#[fF]{3,6}/ // fill blanc ou gris très clair
const WINDOW_BLUE = /#e3f2fd|#0a7|#4a90e2/ // fenêtre paramétrique / ancien trait
const WINDOW_CLASS = /(^|\s)window(\s|$)/i

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

/** Détecte les fenêtres : <rect class="window"> (v2) + <circle> blancs (ancien). */
function detectWindows(svg) {
  const out = []
  // Fenêtres paramétriques v2 : <rect class="window">
  const rectRe = /<rect\b([^>]*)>/gi
  let m
  while ((m = rectRe.exec(svg))) {
    const a = tagAttrs(m[1])
    if (!WINDOW_CLASS.test(a.class ?? '')) continue
    const x = num(a.x); const y = num(a.y)
    const w = num(a.width); const h = num(a.height)
    if (x === null || y === null || w === null || h === null) continue
    out.push({ type: 'window', x, y, w, h })
  }
  // Anciens cercles blancs (rétro-compat).
  const circleRe = /<circle\b([^>]*)\/?>/gi
  while ((m = circleRe.exec(svg))) {
    const a = tagAttrs(m[1])
    if (!WINDOW_FILL.test(a.fill ?? '')) continue
    const cx = num(a.cx); const cy = num(a.cy); const r = num(a.r)
    if (cx === null || cy === null || r === null) continue
    out.push({ type: 'window', x: cx - r, y: cy - r, w: r * 2, h: r * 2, cx, cy, r })
  }
  return out
}

/** Détecte les portes : <path>/<line> class="door" (arc) ou fin rouge (ancien). */
function detectDoors(svg) {
  const out = []
  let seenDoor = false // évite de compter deux fois l'arc + le battant d'une même porte
  const re = /<(line|path|arc)[^>]*>/gi
  let m
  while ((m = re.exec(svg))) {
    const tag = m[0]
    let inner = tag.slice(1, -1)
    if (inner.endsWith('/')) inner = inner.slice(0, -1).trimEnd()
    const a = tagAttrs(inner)
    const cls = a.class ?? ''
    const isDoorClass = /(^|\s)door(\s|$)/i.test(cls)
    if (isDoorClass) {
      // Porte paramétrique v2 (arc d'entrée). Le plan dessine l'arc (<path>)
      // ET le battant (<line>) ; on ne compte qu'UNE porte par groupe pour
      // éviter le double comptage. On enregistre les coordonnées du premier
      // élément du groupe pour donner une géométrie indicative à l'IFC.
      if (!seenDoor) {
        const x1 = num(a.x1); const y1 = num(a.y1)
        let x = 0
        // <path d="M x y A …"> : extraire le point de départ.
        const d = a.d ?? ''
        const dm = /^M\s+([-\d.]+)[,\s]+([-\d.]+)/i.exec(d.trim())
        if (dm) { x = num(dm[1]) ?? 0 }
        seenDoor = true
        out.push({ type: 'door', x, y: num(a.y1) ?? num((/y1="([^"]+)"/.exec(m[0]) || [])[1]) ?? 0, w: 80, h: 6 })
      }
      continue
    }
    // --- rétro-compat : trait fin rouge (ancien générateur) ---
    const strokeWidth = num(a['stroke-width']) ?? num(a['strokeWidth']) ?? 2
    const isWallThick = strokeWidth >= 3
    const hasOpeningColor = /#c00|#d30|red|#f00/i.test(a.stroke ?? '')
    if (isWallThick || !hasOpeningColor) continue
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