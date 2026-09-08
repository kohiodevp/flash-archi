// ===========================================================
// Flash-Archi SaaS — Générateur de plan d'étage 2D (SVG)
// Refonte v2 : rendu professionnel exploitable commercialement.
//
//  - Grande vue (≥1200×900) pour lisibilité imprimable.
//  - Liste complète des pièces (3 chambres, cuisine, salon, SdB,
//    WC, entrée, dégagement, rangement).
//  - Placement "zones jour / nuit" + dégagement central.
//  - Murs intérieurs tracés, portes en arc, fenêtres marquées.
//  - Cotes extérieures, échelle graphique, flèche Nord.
//
//  Unités: coordonnées en PIXELS; 1 m = SCALE px.
//  Retourne { svg, scale, legend } (contrat moteur).
//  Les classes CSS .window / .door sont reconnues par svgOpenings.js.
// ===========================================================

const SCALE = 26 // px par mètre — vue 12m×8.6m ≈ 312×224 grille, padding large
const PAD = 150 // padding pour cotes + échelle + légende
const TOTAL_W = 12 * SCALE + PAD * 2 // ≈ 612 (voir legend ci-dessous)
const TOTAL_H = 8.6 * SCALE + PAD * 2 // ≈ 524

// Grille minimale demandée : viewBox ≥ 1200×900. On force une base de
// travail 1200×900 et on centre la grille dedans (plus de marge).
const VB_W = 1200
const VB_H = 900

// Palette par type de pièce.
const STYLE = {
  salon:      { fill: '#e8f4f8', label: 'Salon' },
  cuisine:    { fill: '#fff4e6', label: 'Cuisine' },
  chambre:    { fill: '#f0e6ff', label: 'Chambre' },
  sdb:        { fill: '#e6f7ff', label: 'Salle de bain' },
  wc:         { fill: '#f5f5f5', label: 'WC' },
  entree:     { fill: '#f9f9f9', label: 'Entrée' },
  degagement: { fill: '#fcfcfc', label: 'Dégagement' },
  rangement:  { fill: '#f0f0f0', label: 'Rangement' },
}

/**
 * Placement des pièces (mètres), zone nuit en haut / dégagement / zone jour.
 * @param {number} nChambres nombre de chambres demandé (1..5)
 * @returns {Array<{name:string,type:string,x:number,y:number,w:number,h:number}>}
 */
function layoutRooms(nChambres) {
  const n = Math.min(Math.max(nChambres || 3, 1), 5)
  const rooms = []
  const bedW = (10 / n) // largeur allouée aux chambres (10 m utiles)
  let x = 0
  for (let i = 0; i < n; i++) {
    rooms.push({ type: 'chambre', name: `Chambre ${i + 1}`, x, y: 0, w: bedW, h: 3.5 })
    x += bedW
  }
  // SdB + WC remplissent le reste de la bande nuit (à droite).
  const sdbW = 2
  const availableNight = 12 - x
  rooms.push({ type: 'sdb', name: 'SdB', x, y: 0, w: Math.min(sdbW, availableNight * 0.5), h: 2.2 })
  rooms.push({ type: 'wc', name: 'WC', x: x + sdbW, y: 0, w: 12 - x - sdbW, h: 1.8 })

  // Dégagement central de circulation.
  rooms.push({ type: 'degagement', name: 'Dégagement', x: 0, y: 3.5, w: 12, h: 1.1 })

  // Zone jour (bas).
  rooms.push({ type: 'salon', name: 'Salon', x: 0, y: 4.6, w: 6.2, h: 4.0 })
  rooms.push({ type: 'cuisine', name: 'Cuisine', x: 6.2, y: 4.6, w: 3.8, h: 4.0 })
  rooms.push({ type: 'entree', name: 'Entrée', x: 10.0, y: 4.6, w: 2.0, h: 3.0 })
  rooms.push({ type: 'rangement', name: 'Rangement', x: 10.0, y: 7.6, w: 2.0, h: 1.0 })
  return rooms
}

/**
 * Génère un plan 2D déterministe et détaillé.
 * @param {object} spec spec.json (surface, rooms, style, etc.)
 * @returns {{svg:string, scale:number, legend:string}}
 */
export function buildPlan2D(spec) {
  const nChambres = Math.max(1, spec.rooms ?? 3)
  const layout = layoutRooms(nChambres)

  // Grille réelle en px, centrée dans la viewBox 1200×900.
  const gridW = 12 * SCALE
  const gridH = 8.6 * SCALE
  const ox = (VB_W - gridW) / 2
  const oy = (VB_H - gridH) / 2

  const P = (v) => Math.round(v) // arrondi

  // ---- Pièces (fonds + labels) ---------------------------------
  let roomsSvg = ''
  let wallsSvg = ''
  layout.forEach((r) => {
    const x = P(ox + r.x * SCALE)
    const y = P(oy + r.y * SCALE)
    const w = P(r.w * SCALE)
    const h = P(r.h * SCALE)
    const st = STYLE[r.type] ?? { fill: '#fafafa', label: r.name }
    const area = Math.round((r.w * r.h) * 10) / 10
    // Police adaptative pour éviter les chevauchements sur pièces étroites.
    let fontSize = 17
    if (w < 105) fontSize = 14
    if (w < 80) fontSize = 12
    if (w < 55) fontSize = 10
    // Nom raccourci sur très petit espace.
    let name = r.name
    if (w < 100 && r.type === 'sdb') name = 'SdB'
    if (w < 100 && r.type === 'degagement') name = 'Dégagement'
    roomsSvg += `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.fill}" stroke="none"/>`
    roomsSvg += `
    <text x="${P(x + w / 2)}" y="${P(y + h / 2 - 2)}" class="label" font-size="${fontSize}">${name}</text>
    <text x="${P(x + w / 2)}" y="${P(y + h / 2 + 14)}" class="area">${area} m²</text>`

    // Murs intérieurs : séparateur vertical (si pas bord gauche) + horizontal
    // recouvrant partiellement pour simuler une cloison (sauf bord extérieur).
    const isLeftEdge = r.x <= 0
    const isBottomEdge = r.y + r.h >= 8.6
    if (!isLeftEdge) {
      wallsSvg += `
    <line x1="${x}" y1="${y + 6}" x2="${x}" y2="${y + h - 6}" class="wall-inner"/>`
    }
    if (!isBottomEdge) {
      wallsSvg += `
    <line x1="${x + 8}" y1="${y}" x2="${x + w - 8}" y2="${y}" class="wall-inner"/>`
    }
  })

  // ---- Enveloppe extérieure ------------------------------------
  const outerW = P(gridW)
  const outerH = P(gridH)
  const outerX = P(ox)
  const outerY = P(oy)

  // ---- Porte d'entrée (arc, en bas de l'entrée) -----------------
  const doorX = P(ox + 11 * SCALE)
  const doorY = P(oy + 7.6 * SCALE)
  const doorArc = `
    <path d="M ${doorX} ${doorY} A 40 40 0 0 1 ${doorX + 40} ${doorY}" class="door"/>
    <line x1="${doorX}" y1="${doorY}" x2="${doorX}" y2="${doorY - 6}" class="door"/>`

  // ---- Fenêtres sur murs extérieurs ------------------------------
  const win = { w: P(1.2 * SCALE), h: 8 } // fenêtre ~1.2 m
  let windowsSvg = ''
  // Mur nord (haut) : une fenêtre par chambre.
  layout.filter((r) => r.type === 'chambre').forEach((r, i) => {
    const cx = P(ox + (r.x + r.w / 2) * SCALE)
    windowsSvg += `
    <rect x="${cx - win.w / 2}" y="${outerY - win.h - 3}" width="${win.w}" height="${win.h}" class="window"/>`
  })
  // Mur sud (bas) : fenêtres salon + cuisine.
  const sw = [layout.find((r) => r.type === 'salon'), layout.find((r) => r.type === 'cuisine')]
  sw.forEach((r) => {
    if (!r) return
    const cx = P(ox + (r.x + r.w / 2) * SCALE)
    windowsSvg += `
    <rect x="${cx - win.w / 2}" y="${outerY + outerH + 3 - win.h}" width="${win.w}" height="${win.h}" class="window"/>`
  })
  // Fenêtres latérales (ouest / est) une de chaque.
  windowsSvg += `
    <rect x="${outerX - win.h - 3}" y="${P(oy + 2 * SCALE)}" width="${win.h}" height="${win.w}" class="window"/>
    <rect x="${outerX + outerW + 3}" y="${P(oy + 2 * SCALE)}" width="${win.h}" height="${win.w}" class="window"/>`

  // ---- Cotes extérieures -----------------------------------------
  const widthM = layout.reduce((m, r) => (r.x + r.w > m ? r.x + r.w : m), 0)
  const heightM = layout.reduce((m, r) => (r.y + r.h > m ? r.y + r.h : m), 0)
  const dimension = `
    <line x1="${outerX}" y1="${outerY + outerH + 40}" x2="${outerX + outerW}" y2="${outerY + outerH + 40}" stroke="#999" stroke-width="1"/>
    <line x1="${outerX}" y1="${outerY + outerH + 34}" x2="${outerX}" y2="${outerY + outerH + 46}" stroke="#999" stroke-width="1"/>
    <line x1="${outerX + outerW}" y1="${outerY + outerH + 34}" x2="${outerX + outerW}" y2="${outerY + outerH + 46}" stroke="#999" stroke-width="1"/>
    <text x="${P(ox + outerW / 2)}" y="${outerY + outerH + 62}" class="dimension" text-anchor="middle">${widthM.toFixed(1)} m</text>
    <line x1="${outerX - 40}" y1="${outerY}" x2="${outerX - 40}" y2="${outerY + outerH}" stroke="#999" stroke-width="1"/>
    <line x1="${outerX - 34}" y1="${outerY}" x2="${outerX - 46}" y2="${outerY}" stroke="#999" stroke-width="1"/>
    <line x1="${outerX - 34}" y1="${outerY + outerH}" x2="${outerX - 46}" y2="${outerY + outerH}" stroke="#999" stroke-width="1"/>
    <text x="${outerX - 58}" y="${P(oy + outerH / 2)}" class="dimension" text-anchor="middle" transform="rotate(-90 ${outerX - 58} ${outerY + outerH / 2})">${heightM.toFixed(1)} m</text>`

  // ---- Échelle graphique ------------------------------------------
  const axisX = 5 * SCALE // 5 m d'échelle
  const axisY = outerY + outerH + 110
  let scaleBar = ''
  scaleBar += `
    <g transform="translate(${outerX}, ${axisY})">
      <rect x="0" y="0" width="${axisX}" height="8" fill="#333"/>
      <rect x="${axisX}" y="0" width="${axisX}" height="8" fill="#fff" stroke="#333"/>
      <rect x="${2 * axisX}" y="0" width="${axisX}" height="8" fill="#333"/>
      <rect x="${3 * axisX}" y="0" width="${axisX}" height="8" fill="#fff" stroke="#333"/>
      <rect x="${4 * axisX}" y="0" width="${axisX}" height="8" fill="#333"/>
      <text x="0" y="26" class="dimension">0</text>
      <text x="${axisX}" y="26" class="dimension" text-anchor="middle">5m</text>
      <text x="${2 * axisX}" y="26" class="dimension" text-anchor="middle">10m</text>
      <text x="${3 * axisX}" y="26" class="dimension" text-anchor="middle">15m</text>
      <text x="${4 * axisX}" y="26" class="dimension" text-anchor="middle">20m</text>
      <text x="${2.5 * axisX}" y="42" class="dimension" text-anchor="middle">Échelle 1/50</text>
    </g>`

  // ---- Flèche Nord ------------------------------------------------
  const north = `
    <g transform="translate(${outerX + 40}, ${outerY + 40})">
      <polygon points="0,-20 10,2 0,-6 -10,2" fill="#c41e3a"/>
      <text x="0" y="-27" class="dimension" text-anchor="middle" fill="#c41e3a">N</text>
    </g>`

  // ---- Assemblage -------------------------------------------------
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}">
  <defs>
    <style>
      .wall-outer { stroke:#2c2c2c; stroke-width:7; fill:none; }
      .wall-inner { stroke:#8a6f52; stroke-width:4; fill:none; }
      .door { stroke:#8b4513; stroke-width:3; fill:none; }
      .window { stroke:#4a90e2; stroke-width:3; fill:#e3f2fd; }
      .label { font-family:Arial, sans-serif; font-size:17px; fill:#333; text-anchor:middle; }
      .area { font-family:Arial, sans-serif; font-size:13px; fill:#888; text-anchor:middle; }
      .dimension { font-family:Arial, sans-serif; font-size:14px; fill:#555; }
    </style>
  </defs>
  <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#fafafa"/>
  <g transform="translate(0,0)">
    ${roomsSvg}
    <rect x="${outerX}" y="${outerY}" width="${outerW}" height="${outerH}" class="wall-outer"/>
    ${wallsSvg}
    ${windowsSvg}
    ${doorArc}
    ${dimension}
    ${scaleBar}
    ${north}
  </g>
</svg>`

  return { svg, scale: 50, legend: 'Murs ext. 25cm — Portes (arc) — Fenêtres — Échelle 1/50' }
}

export default buildPlan2D