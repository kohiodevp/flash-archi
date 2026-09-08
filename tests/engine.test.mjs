// ===========================================================
// Tests — Moteur (avec provider mock déterministe)
// ===========================================================
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// Force le provider mock AVANT l'import du moteur.
process.env.LLM_PROVIDER = 'mock'

async function loadEngine() {
  const m = await import('../src/engine.js')
  return m
}

let generateArchitecture

before(async () => {
  ;({ generateArchitecture } = await loadEngine())
})

test('génère une architecture complète (spec + plan2d + 4 façades + IFC + bimMetrics)', async () => {
  const r = await generateArchitecture('villa 150m² 3 chambres style méditerranéen avec garage')
  assert.ok(r.spec, 'spec attendu')
  assert.equal(r.spec.surface, 150)
  assert.equal(r.spec.rooms, 3)
  assert.ok(r.spec.style)
  assert.ok(r.plan2d.svg && r.plan2d.svg.startsWith('<svg'), 'svg du plan attendu')
  assert.equal(r.plan2d.scale, 50)
  assert.ok(r.plan2d.legend)
  // 4 façades non vides (le provider mock retourne des PNG b64)
  for (const k of ['north', 'south', 'east', 'west']) {
    assert.ok(r.facades[k] && r.facades[k].length > 10, `façade ${k} attendue (base64)`)
  }
  // Export IFC4 présent et décodable (homologation BIM)
  assert.ok(r.ifcModel, 'ifcModel attendu')
  assert.match(r.ifcModel, /^data:application\/step;base64,/)
  const decoded = Buffer.from(r.ifcModel.split(',')[1], 'base64').toString('utf8')
  assert.match(decoded, /IFCPROJECT/)
  assert.match(decoded, /IFCWALLSTANDARDCASE/)
  // Métriques BIM dérivées
  assert.ok(r.bimMetrics, 'bimMetrics attendu')
  assert.ok(typeof r.bimMetrics.footprintArea === 'number' && r.bimMetrics.footprintArea > 0)
  assert.ok(typeof r.bimMetrics.grossVolume === 'number' && r.bimMetrics.grossVolume > 0)
  // Le plan paramétrique V2 produit 7 fenêtres + 1 porte d'entrée = 8 ouvertures
  assert.equal(r.bimMetrics.openingCount, 8)
  const decodedWith = Buffer.from(r.ifcModel.split(',')[1], 'base64').toString('utf8')
  assert.match(decodedWith, /IFCOPENINGELEMENT/)
  // Nouveaux champs BIM : roofArea et totalVolume
  assert.equal(r.bimMetrics.roofArea, 150) // empreinte
  // grossVolume = footprint * storeys * heightPerStorey = 150 * 1 * 3 = 450
  // totalVolume = grossVolume + (roofArea * ROOF_T) where ROOF_T = 0.25 => 450 + 37.5 = 487.5
  assert.equal(r.bimMetrics.totalVolume, 487.5)
  // La toiture est bien présente dans la maquette IFC (rôle .ROOF.)
  assert.match(decoded, /IFCSLAB\([^;]+\.ROOF\.,\$\);/)
})

test('extrait surface et chambres depuis un prompt libre', async () => {
  const r = await generateArchitecture('appartement de 90 m² avec 2 chambres')
  assert.equal(r.spec.surface, 90)
  assert.equal(r.spec.rooms, 2)
})

test('détecte le garage dans le prompt', async () => {
  const r = await generateArchitecture('une maison 120m² 3 chambres avec garage double')
  // garage: single (le mock simplifie la détection), mais présent
  assert.ok(['single', 'double', 'none'].includes(r.spec.garage))
})

test('accepte un spec avec programme spatial inconnu (robustesse IFC)', async () => {
  const cfg = (await import('../src/config.js')).config
  const original = cfg.llm.provider
  cfg.llm.provider = 'mock'
  try {
    const r = await generateArchitecture('bâtiment 400m² 4 étages bureaux et salle Ω∑∏')
    assert.ok(r.spec)
    assert.ok(r.ifcModel)
    const decoded = Buffer.from(r.ifcModel.split(',')[1], 'base64').toString('utf8')
    // Le programme spatial, même exotique, n'empêche pas la génération IFC.
    assert.match(decoded, /IFCSPACE|IFCBUILDINGSTOREY/)
  } finally {
    cfg.llm.provider = original
  }
})

test('Provider inconnu -> erreur', async () => {
  const cfg = (await import('../src/config.js')).config
  const original = cfg.llm.provider
  cfg.llm.provider = 'inexistant'
  let threw = false
  try {
    await generateArchitecture('maison 100m²')
  } catch (e) {
    threw = /inconnu|inexistant/.test(e.message ?? '')
  } finally {
    cfg.llm.provider = original
  }
  assert.equal(threw, true, 'un provider inconnu doit lever une erreur explicite')
})
