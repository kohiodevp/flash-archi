// ===========================================================
// Tests — Détection d'ouvertures (fenêtres, portes) dans SVG
//
// Vérifie la robustesse du détecteur sur :
//   - Cercle blanc (fenêtre)
//   - Ligne fine contrastée (porte simple, porte pointillée)
//   - Ligne épaisse (mur, à ignorer)
//   - Aucune fausse détection sur fond blanc ou traits gris
// Utilise le SVG réel du mock comme référence de base.
// ===========================================================
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { detectOpenings, countOpenings } from '../src/svgOpenings.js'

let svgBase

beforeEach(() => {
  // SVG du mock LLM (plan 2D de base avec une fenêtre)
  svgBase = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect x="20" y="20" width="560" height="360" fill="none" stroke="#1d1d1b" stroke-width="4"/><rect x="140" y="120" width="300" height="160" fill="none" stroke="#1d1d1b" stroke-width="4"/><line x1="140" y1="200" x2="440" y2="200" stroke="#d30"/><circle cx="420" cy="200" r="8" fill="white" stroke="#d30" stroke-width="2"/><line x1="330" y1="200" x2="330" y2="120" stroke="#c00" stroke-width="2" stroke-dasharray="4 3"/><text x="340" y="300" font-size="12">1/50</text></svg>'
})

test('détecte une fenêtre blanche dans le SVG mock', () => {
  const openings = detectOpenings(svgBase)
  const win = openings.find(o => o.type === 'window')
  assert.ok(win, 'une fenêtre attendue')
  assert.equal(win.cx, 420)
  assert.equal(win.cy, 200)
  assert.equal(win.r, 8)
})

test('détecte fenêtre + porte fine (ligne pointillée), ignore la cloison longue', () => {
  const openings = detectOpenings(svgBase)
  assert.equal(openings.length, 2)  // fenêtre + porte (la cloison 300px est exclue)
  const types = openings.map(o => o.type).sort()
  assert.deepEqual(types, ['door', 'window'])
  const door = openings.find(o => o.type === 'door')
  assert.equal(door.w, 80) // la porte pointillée du mock
})

test('ignore les traits épais (murs du SVG)', () => {
  // Construire un SVG contenant uniquement un trait épais noir (mur)
  const thickWallSvg = '<svg width="200" height="200"><line x1="0" y1="100" x2="200" y2="100" stroke="black" stroke-width="5"/></svg>'
  const openings = detectOpenings(thickWallSvg)
  assert.equal(openings.length, 0)
})

test('ne détecte rien sur un SVG sans ouverture', () => {
  const plainSvg = '<svg width="200" height="200"><rect x="10" y="10" width="180" height="180" fill="none" stroke="black"/></svg>'
  assert.equal(countOpenings(plainSvg), 0)
})

test('gestion de la casse et des couleurs alternatives', () => {
  const svgWhiteCircle = '<svg width="100" height="100"><circle cx="50" cy="50" r="10" fill="#FFFFFF"/></svg>'
  const openings = detectOpenings(svgWhiteCircle)
  assert.equal(openings.length, 1)
  assert.equal(openings[0].type, 'window')
})