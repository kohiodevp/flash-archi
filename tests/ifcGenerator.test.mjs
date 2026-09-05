// ===========================================================
// Tests — Générateur IFC4
// Vérifie structure, entités attendues et types inconnus réels.
// ===========================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIfcText, generateIfcModel } from '../src/ifcGenerator.js'

function refsDefined(text) {
  // Toutes les #N référencées (#N=...) existent comme définition.
  const defined = new Set()
  for (const m of text.matchAll(/^#(\d+)=/gm)) defined.add(Number(m[1]))
  // Les références au sein des définitions (hors "#N=" début) : on les
  // approxime en cherchant "#<num>" partout et en retirant celles qui sont
  // le début d'une définition.
  const used = new Set()
  for (const m of text.matchAll(/#(\d+)/g)) {
    used.add(Number(m[1]))
  }
  for (const u of used) {
    if (!defined.has(u)) return u // identifiant pendu
  }
  return null
}

test('buildIfcText : en-tête ISO + section DATA', () => {
  const t = buildIfcText({ surface: 150, storeys: 1, style: 'x' })
  assert.match(t, /^ISO-10303-21;/)
  assert.match(t, /HEADER;/)
  assert.match(t, /DATA;/)
  assert.match(t, /ENDSEC;/)
  assert.match(t, /END-ISO-10303-21;/)
})

test('buildIfcText : contient IFCPROJECT, IFCSITE, IFCBUILDING, IFCSLAB, IFCWALLSTANDARDCASE', () => {
  const t = buildIfcText({ surface: 150, storeys: 1, style: 'x' })
  for (const ent of ['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCSLAB', 'IFCWALLSTANDARDCASE', 'IFCRELAGGREGATES']) {
    assert.ok(new RegExp(`=IFC${ent.replace(/^IFC/, '')}\\b|=${ent}\\b`).test(t) || t.includes(`=${ent}(`), `entité ${ent} absente`)
  }
})

test('buildIfcText : références #n toutes définies (aucun identifiant pendu)', () => {
  const t = buildIfcText({ surface: 150, storeys: 2, heightPerStorey: 2.8, style: 'x' })
  const pending = refsDefined(t)
  assert.equal(pending, null, `référence pendante #${pending}`)
})

test('buildIfcText : un IFCSPACE par programme spatial y compris nom inconnu', () => {
  const t = buildIfcText({
    surface: 200, storeys: 2, style: 'contemporain',
    spaceProgram: [{ name: 'Salle Ω∑∏', area: 12.5 }, { name: "L'\u2019atelier", area: 30 }],
  })
  const count = (t.match(/=IFCSPACE\(/g) || []).length
  assert.equal(count, 2)
  // Le nom échappé ne casse pas l'apostrophe IFC.
  assert.ok(t.includes('Salle Ω∑∏'))
})

test('buildIfcText : multiple étages -> storeys occurrences', () => {
  const t = buildIfcText({ surface: 300, storeys: 3, heightPerStorey: 3.0, style: 'x' })
  const count = (t.match(/=IFCBUILDINGSTOREY\(/g) || []).length
  assert.equal(count, 3)
})

test('generateIfcModel : retourne un Uint8Array dont le texte est cohérent', () => {
  const buf = generateIfcModel({ surface: 100, storeys: 1 })
  assert.ok(buf instanceof Uint8Array)
  const text = new TextDecoder().decode(buf)
  assert.match(text, /IFCPROJECT/)
})

test('buildIfcText : ajoute IFCOPENINGELEMENT + IFCRELVOIDSELEMENT quand openings fournis', () => {
  const openings = [
    { type: 'window', x: 412, y: 192, w: 16, h: 16 },
    { type: 'door', x: 330, y: 120, w: 80, h: 2 },
  ]
  const t = buildIfcText({ surface: 150, storeys: 2 }, openings)
  const openCount = (t.match(/=IFCOPENINGELEMENT\(/g) || []).length
  const voidCount = (t.match(/=IFCRELVOIDSELEMENT\(/g) || []).length
  // 1 ouverture par niveau (répartition par tour) sur 2 niveaux
  assert.equal(openCount, 4)
  assert.equal(voidCount, 4)
  // Chaque ouverture est bien référencée et aucune référence pendante
  const pending = refsDefined(t)
  assert.equal(pending, null, `référence pendante #${pending}`)
})

test('buildIfcText : sans openings, aucun IFCOPENINGELEMENT ni IFCRELVOIDSELEMENT', () => {
  const t = buildIfcText({ surface: 150, storeys: 2 })
  assert.equal((t.match(/=IFCOPENINGELEMENT\(/g) || []).length, 0)
  assert.equal((t.match(/=IFCRELVOIDSELEMENT\(/g) || []).length, 0)
})

test('buildIfcText : génère une toiture (IFCSLAB .ROOF.) au sommet', () => {
  const t = buildIfcText({ surface: 150, storeys: 2, heightPerStorey: 3.0 })
  // Une seule toiture, de rôle .ROOF.
  const roofs = t.match(/=IFCSLAB\([^;]+\.ROOF\.,\$\);/g) || []
  assert.equal(roofs.length, 1)
  // La toiture est portée par le bâtiment (agrégat)
  assert.match(t, /IFCRELAGGREGATES\([^;]+,\(#\d+\)\);/)
  // Aucune référence pendante
  assert.equal(refsDefined(t), null)
})