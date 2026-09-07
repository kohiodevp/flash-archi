// ===========================================================
// Flash-Archi SaaS — Générateur de façades paramétrique
// Option B : template SVG paramétrique rempli selon la spec,
// converti en PNG (sharp) puis encodé en base64.
// Résout le problème des "façades trop courtes" du mock.
// ===========================================================
import sharp from 'sharp'

const PALETTE = {
  blanc:        { wall: '#f2f0eb', trim: '#d8d4cc', roof: '#8a5a44', window: '#7fb2d9', accent: '#b0453a' },
  beige:        { wall: '#e8dcc8', trim: '#c9b896', roof: '#7a5230', window: '#79a8cc', accent: '#a0542e' },
  terre:        { wall: '#d9c2a3', trim: '#b99a6e', roof: '#6f4426', window: '#6f9fc9', accent: '#8f4a2e' },
  gris:         { wall: '#d6d3ce', trim: '#b0aca6', roof: '#4f4b47', window: '#6f97b8', accent: '#a05838' },
  'bleu clair':  { wall: '#d8e2e8', trim: '#b0c4cf', roof: '#5a6b78', window: '#5f8fb8', accent: '#a05a3a' },
  tropical:     { wall: '#f5e8d3', trim: '#d9c39a', roof: '#b3563a', window: '#6fae8a', accent: '#5a7d5a' },
  meditarraneo: { wall: '#f7efe0', trim: '#d9c9a8', roof: '#a0452f', window: '#6f9fc9', accent: '#2e5a7a' },
}

const DEFAULT_PALETTE = PALETTE.blanc

function paletteFor(spec) {
  const style = (spec.style ?? '').toLowerCase()
  if (style.includes('tropical')) return PALETTE.tropical
  if (style.includes('méditerranéen') || style.includes('mediterraneen') || style.includes('provençal')) return PALETTE.meditarraneo
  const facadeColor = (spec.facadeColor ?? '').toLowerCase()
  if (PALETTE[facadeColor]) return PALETTE[facadeColor]
  if (facadeColor.includes('beige')) return PALETTE.beige
  if (facadeColor.includes('terre')) return PALETTE.terre
  if (facadeColor.includes('gris')) return PALETTE.gris
  return DEFAULT_PALETTE
}

/** Génère le SVG d'une façade selon orientation + spec. */
export function buildFacadeSvg(spec, orientation) {
  const pal = paletteFor(spec)
  const storeys = Math.max(1, spec.storeys ?? 1)
  const heightPerStorey = spec.heightPerStorey ?? 3.0
  const widthM = Math.max(8, spec.widthM ?? Math.sqrt(spec.surface ?? 120) ?? 12)
  const ratio = 42 // pixels par mètre → façade ~450px de large, nette
  const W = Math.round(widthM * ratio)
  const totalH = Math.round(storeys * heightPerStorey * ratio)
  const perH = Math.round(totalH / storeys)
  const groundH = Math.round(ratio * 2.2) // socle au sol (pixels)
  const H = totalH + groundH

  const roofStyle = (spec.roof ?? '').toLowerCase()
  const flatRoof = roofStyle.includes('plat') || roofStyle.includes('terrasse') || roofStyle.includes('moderne')

  // Fenêtres par niveau
  const nWindows = clamp(Math.round(widthM / 3.5), 2, 6)
  const winW = clamp(Math.round(perH * 0.42), 26, 48)
  const winH = clamp(Math.round(perH * 0.38), 30, 58)
  const winGap = (W - nWindows * winW) / (nWindows + 1)

  let windows = ''
  for (let floor = 0; floor < storeys; floor++) {
    const yBase = H - groundH - (floor + 1) * perH + Math.round((perH - winH) / 2)
    for (let i = 0; i < nWindows; i++) {
      const x = winGap + i * (winW + winGap)
      // Meneau central (double fenêtre)
      windows += `<g>
        <rect x="${x}" y="${yBase}" width="${winW}" height="${winH}" rx="2" fill="${pal.window}" stroke="${pal.trim}" stroke-width="2"/>
        <line x1="${x + winW / 2}" y1="${yBase}" x2="${x + winW / 2}" y2="${yBase + winH}" stroke="${pal.trim}" stroke-width="2"/>
        <line x1="${x}" y1="${yBase + winH / 2}" x2="${x + winW}" y2="${yBase + winH / 2}" stroke="${pal.trim}" stroke-width="1"/>
        <rect x="${x - 2}" y="${yBase - 2}" width="${winW + 4}" height="${winH + 4}" fill="none" stroke="${pal.accent}" stroke-width="1" opacity="0.5"/>
      </g>`
    }
  }

  // Porte d'entrée au rez-de-chaussée
  const doorW = clamp(Math.round(perH * 0.4), 34, 56)
  const doorH = Math.min(totalH, Math.round(perH * 0.75))
  const doorX = Math.round(W / 2 - doorW / 2)
  const doorY = H - groundH - doorH + 10

  let roof
  if (flatRoof) {
    roof = `<rect x="-8" y="${H - totalH - 14}" width="${W + 16}" height="16" fill="${pal.roof}"/>`
  } else {
    const roofOver = 18
    roof = `<polygon points="${-roofOver},${H - totalH} ${W / 2},${H - totalH - perH * 0.9} ${W + roofOver},${H - totalH}" fill="${pal.roof}"/>`
  }

  const label = labelOrientation(orientation)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- fond + socle -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="${pal.wall}"/>
  <rect x="0" y="${H - groundH}" width="${W}" height="${groundH}" fill="${pal.wall}" stroke="${pal.trim}" stroke-width="3"/>
  <!-- ligne de toit -->
  ${roof}
  <!-- fenêtres -->
  ${windows}
  <!-- porte -->
  <g>
    <rect x="${doorX}" y="${doorY}" width="${doorW}" height="${H - groundH - doorY}" rx="2" fill="${pal.accent}" stroke="${pal.trim}" stroke-width="2"/>
    <circle cx="${doorX + doorW * 0.8}" cy="${doorY + 30}" r="3" fill="${pal.wall}"/>
  </g>
  <!-- étiquette orientation -->
  <text x="${W / 2}" y="${H - 20}" font-family="sans-serif" font-size="20" font-weight="bold" fill="${pal.trim}" text-anchor="middle">${label}</text>
</svg>`
  return svg
}

function labelOrientation(o) {
  const map = { north: 'FAÇADE NORD', south: 'FAÇADE SUD', east: 'FAÇADE EST', west: 'FAÇADE OUEST' }
  return map[o] ?? o.toUpperCase()
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function keyForSpec(spec) {
  return [
    spec.surface ?? 120,
    spec.storeys ?? 1,
    spec.heightPerStorey ?? 3,
    spec.style ?? 'contemporain',
    spec.facadeColor ?? 'blanc',
    spec.roof ?? 'plat',
  ].join('|')
}

// Cache mémoire des SVG générés (déterministe → évite de re-rendre).
const svgCache = new Map()

/**
 * Génère une façade en PNG base64.
 * @param {object} spec
 * @param {'north'|'south'|'east'|'west'} orientation
 * @returns {Promise<string>} data URI PNG (base64)
 */
export async function generateFacadePng(spec, orientation) {
  const key = `${orientation}:${keyForSpec(spec)}`
  const cacheKey = `facade:${key}`
  const memo = svgCache.get(cacheKey)
  let svg
  if (memo) {
    svg = memo.svg
  } else {
    svg = buildFacadeSvg(spec, orientation)
    svgCache.set(cacheKey, { svg })
    if (svgCache.size > 200) svgCache.delete(svgCache.keys().next().value)
  }
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

/**
 * Génère les 4 façades.
 * @returns {Promise<{north:string,south:string,east:string,west:string}>} data URIs PNG
 */
export async function generateAllFacades(spec) {
  const [north, south, east, west] = await Promise.all(
    ['north', 'south', 'east', 'west'].map((o) => generateFacadePng(spec, o))
  )
  return { north, south, east, west }
}

/** Utile pour le mock : force le style réaliste même si l'intention est sommaire. */
export function completeSpec(spec) {
  return {
    ...spec,
    widthM: spec.widthM ?? (spec.surface ? Math.max(8, Math.sqrt(spec.surface)) : 12),
    storeys: spec.storeys ?? 1,
    heightPerStorey: spec.heightPerStorey ?? 3.0,
  }
}