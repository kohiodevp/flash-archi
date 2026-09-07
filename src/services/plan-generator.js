// ===========================================================
// Flash-Archi SaaS — Générateur de plan d'étage 2D (SVG)
// Option "template paramétrique" : murs épais, murs intérieurs,
// portes (arc), fenêtres (double trait), labels, cotes, échelle.
// ===========================================================

// Layout pièces par défaut (grille) selon surface/pièces.
function computeRooms(spec) {
  const rooms = Math.max(1, spec.rooms ?? 3)
  const surface = Math.max(30, spec.surface ?? 120)
  const cols = Math.ceil(Math.sqrt(rooms))
  const rows = Math.ceil(rooms / cols)
  const outerW = Math.round(Math.sqrt(surface) * 8) // ~1u = 8px
  const outerH = Math.round(outerW * (rows / cols))
  const innerW = outerW - 40
  const innerH = outerH - 40
  const cellW = innerW / cols
  const cellH = innerH / rows
  return { outerW, outerH, innerW, innerH, cols, rows, cellW, cellH, rooms }
}

const ROOM_LABELS = ['Salon', 'Chambre', 'Cuisine', 'Salle d\'eau', 'Bureau', 'Séjour', 'Cellier', 'Vestibule']

function roomLabel(i) {
  if (i === 0) return 'Séjour/Entrée'
  if (i === 1) return 'Chambre 1'
  if (i === 2) return 'Cuisine'
  // i >= 3 : index décorrélé pour éviter les doublons (Cuisine/Séjour).
  const pool = ['Chambre 2', "Salle d'eau", 'Bureau', 'Séjour', 'Cellier', 'Vestibule', 'Terrasse']
  return pool[(i - 3) % pool.length] ?? 'Pièce'
}

/**
 * Génère un plan 2D déterministe (murs, pièces, portes, fenêtres, cotes).
 * @param {object} spec spec.json (surface, rooms, etc.)
 * @returns {{svg:string, scale:number, legend:string}}
 */
export function buildPlan2D(spec) {
  const { outerW, outerH, innerW, innerH, cols, rows, cellW, cellH, rooms } = computeRooms(spec)

  const pad = 50
  const W = outerW + pad * 2
  const H = outerH + pad * 2
  const ox = pad
  const oy = pad

  // Murs extérieurs (trait épais)
  const outer = `<rect x="${ox}" y="${oy}" width="${outerW}" height="${outerH}" fill="#fffdf8" stroke="#1d1d1b" stroke-width="8"/>`

  // Cellules / murs intérieurs + labels des pièces
  let interior = ''
  let labels = ''
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= rooms) break
      const x = ox + c * cellW
      const y = oy + r * cellH
      const isRightEdge = i % cols === cols - 1 || i === rooms - 1
      const isBottomEdge = r === rows - 1 || i + cols >= rooms
      // murs intérieurs (traits fins) sauf bord extérieur
      if (!isRightEdge) {
        interior += `<line x1="${x + cellW}" y1="${y + 6}" x2="${x + cellW}" y2="${y + cellH - 6}" stroke="#555" stroke-width="4"/>`
      }
      if (!isBottomEdge) {
        interior += `<line x1="${x + 6}" y1="${y + cellH}" x2="${x + cellW - 6}" y2="${y + cellH}" stroke="#555" stroke-width="4"/>`
      }
      labels += `<text x="${x + cellW / 2}" y="${y + cellH / 2 - 8}" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#333">${roomLabel(i)}</text>`
      labels += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 18}" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#888">${Math.round((cellW * cellH) / 64)} m²</text>`
      i++
    }
  }

  // Portes (arc) + fenêtres sur le mur extérieur — symboles conformes aux
  // conventions du moteur (svgOpenings.js) :
  //   - fenêtre = <circle fill="white"> posé sur le mur (symbol standard plan)
  //   - porte   = arc fin rouge (#d30, stroke-width 2) — détecté comme door
  const doorSize = 40
  const doorX = ox + outerW / 2
  const doorY = oy + outerH
  const doorArc = `<g>
    <line x1="${doorX - 6}" y1="${doorY - 4}" x2="${doorX - 6}" y2="${doorY + 4}" stroke="#1d1d1b" stroke-width="5"/>
    <line x1="${doorX + doorSize}" y1="${doorY - 4}" x2="${doorX + doorSize}" y2="${doorY + 4}" stroke="#1d1d1b" stroke-width="5"/>
    <path d="M ${doorX} ${doorY} A ${doorSize} ${doorSize} 0 0 0 ${doorX - doorSize} ${doorY}" fill="none" stroke="#d30" stroke-width="2"/>
  </g>`

  const winSize = 26
  const winR = winSize / 2
  const fenetres = `<g>
    <circle cx="${ox + 60 + winR}" cy="${oy + winR}" r="${winR}" fill="white" stroke="#0a7" stroke-width="2"/>
    <circle cx="${ox + outerW - 60 - winR}" cy="${oy + winR}" r="${winR}" fill="white" stroke="#0a7" stroke-width="2"/>
    <circle cx="${ox + winR}" cy="${oy + 60 + winR}" r="${winR}" fill="white" stroke="#0a7" stroke-width="2"/>
    <circle cx="${ox + outerW - winR}" cy="${oy + 60 + winR}" r="${winR}" fill="white" stroke="#0a7" stroke-width="2"/>
  </g>`

  // Cotes (dimensions)
  const coteH = `<text x="${ox + outerW / 2}" y="${oy + outerH + 42}" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#555">${spec.widthM ?? 12} m</text>`
  const coteV = `<text x="${ox - 12}" y="${oy + outerH / 2}" font-family="sans-serif" font-size="14" text-anchor="middle" transform="rotate(-90 ${ox - 12} ${oy + outerH / 2})" fill="#555">${spec.heightPerStorey ?? 3} m/ét.</text>`

  // Orientation nord
  const norte = `<g transform="translate(${ox + 30}, ${oy - 28})">
    <polygon points="0,16 6,0 12,16" fill="#b0453a"/>
    <text x="6" y="-4" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#b0453a">N</text>
  </g>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- fond du planche -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="#f4f1ea"/>
  ${outer}
  ${interior}
  ${fenetres}
  ${doorArc}
  ${labels}
  ${coteH}
  ${coteV}
  ${norte}
</svg>`

  return { svg, scale: 50, legend: 'Murs 20 cm — Portes (arc) — Fenêtres — Échelle 1/50' }
}