// ===========================================================
// Flash-Archi SaaS — Générateur de modèle IFC4 (binaire)
// Génère une maquette IFC4 (ISO-10303-21) SCHÉMATIQUE mais
// structurellement cohérente, destinée aux échanges BIM de
// conception : empreinte carrée extrudée par étage (dalles
// IFCSLAB + murs IFCWALLSTANDARDCASE), les ouvertures détectées
// dans le plan 2D (IfcOpeningElement + IfcRelVoidsElement),
// IFCSPACE pour le programme spatial, agrégation
// Projet/Site/Bâtiment/Étages.
//
// Limites assumées : géométrie 2,5D (pas de toitures, pas de
// classifications étendues, masses simplifiées, répartition des
// ouvertures par tour sur les murs périphériques).
// ===========================================================

const GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
function ifcGuid(seed) {
  let n = seed >>> 0
  let out = ''
  for (let i = 0; i < 22; i++) {
    out += GUID_ALPHABET[n % GUID_ALPHABET.length]
    n = (n * 31) >>> 0
  }
  return out
}

function esc(s) {
  return String(s ?? '').replace(/'/g, "''").replace(/\\/g, '\\\\')
}

const f = (x) => Number(x).toFixed(4)

/**
 * Construit la maquette IFC4 (contenu ISO-10303-21).
 * @param {object} spec FlashSpec (surface, storeys, heightPerStorey, spaceProgram...)
 * @returns {string} Contenu IFC4.
 */
export function buildIfcText(spec, openings = []) {
  const storeys = Math.max(1, Math.round(spec.storeys ?? 1))
  const height = Number(spec.heightPerStorey ?? 3.0)
  const areaPerStorey = Math.max(1, (spec.surface ?? 100)) / storeys
  const side = Math.sqrt(areaPerStorey)
  const lx = side / 2
  const ly = side / 2
  const WALL_T = 0.25
  const SLAB_T = 0.2
  const spaceProgram = spec.spaceProgram ?? []

  // Norme des ouvertures : fenêtre ~60% de la hauteur, porte ~90% (en m)
  const OPEN_H_WINDOW = height * 0.6
  const OPEN_H_DOOR = height * 0.92

  const H = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('flash-archi-build.ifc','2026-01-01T00:00:00',(''),(''),'Flash-Archi SaaS','Flash-Archi SaaS','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ]

  const L = []
  let n = 1
  const e = (s) => { L.push(`#${n++}=${s}`) }

  // Agrégations Projet/Site/Bâtiment — définies tôt pour permettre la
  // toiture et les étages de référencer le bâtiment pendant l'émission.
  const aggr = []
  let relSeq = 900
  const pushAggr = (relating, related) => {
    aggr.push(`#${n++}=IFCRELAGGREGATES('${ifcGuid(relSeq++)}',$,$,$,#${relating},(${related.map((x) => `#${x}`).join(',')}));`)
  }

  // Contexte géométrique référencé par IFCPROJECT.
  e(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${n + 1},$);`)
  const ctxId = n - 1
  e(`IFCCARTESIANPOINT((0.,0.,0.));`) // position du contexte
  e(`IFCAXIS2PLACEMENT3D(#${ctxId + 1},$,$);`) // world placement
  e(`IFCPROJECT('${ifcGuid(1)}',$,'Flash-Archi',$,$,$,$,(#${ctxId}),$);`)
  const projectId = n - 1

  // Direction d'extrusion verticale (partagée par dalles et murs).
  e(`IFCDIRECTION((0.,0.,1.));`)
  const extDir = n - 1

  e(`IFCSITE('${ifcGuid(2)}',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);`)
  const siteId = n - 1
  e(`IFCBUILDING('${ifcGuid(3)}',$,'Bâtiment',$,$,$,$,$,.ELEMENT.,$,.ELEMENT.,$,Direct,0.);`)
  const buildingId = n - 1

  const storeyIds = []
  for (let s = 0; s < storeys; s++) {
    const wallRefs = []
    const zBase = +(s * height).toFixed(4)
    const zP = n
    e(`IFCCARTESIANPOINT((0.,0.,${zBase.toFixed(4)}));`)
    const zAxis = n
    e(`IFCAXIS2PLACEMENT3D(#${zP},$,$);`)
    e(`IFCBUILDINGSTOREY('${ifcGuid(10 + s)}',$,'Niveau ${s + 1}',$,$,#${zAxis},$,.ELEMENT.,${zBase.toFixed(4)});`)
    storeyIds.push(n - 1)

    // Dalle (IFCSLAB rectangulaire extrudée)
    const slabPlace = n
    e(`IFCAXIS2PLACEMENT3D(#${zP},$,$);`)
    const profPlace = n
    e(`IFCAXIS2PLACEMENT3D(#${zP},$,$);`)
    const prof = n
    e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,'Dalle',#${profPlace},${f(lx * 2)},${f(ly * 2)});`)
    const solidPlace = n
    e(`IFCAXIS2PLACEMENT3D(#${zP},$,$);`)
    const solid = n
    e(`IFCEXTRUDEDAREASOLID(#${prof},#${solidPlace},#${extDir},${f(SLAB_T)});`)
    const reprPlace = n
    e(`IFCAXIS2PLACEMENT3D(#${zP},$,$);`)
    const shapeRepr = n
    e(`IFCSHAPEREPRESENTATION(#${reprPlace},'Body','SweptSolid',(#${solid}));`)
    e(`IFCSLAB('${ifcGuid(300 + s)}',$,'Dalle Niveau ${s + 1}',$,$,#${slabPlace},#${shapeRepr},$,.FLOOR.,$);`)
    const slabId = n - 1

    // 4 murs IFCWALLSTANDARDCASE sur le pourtour
    const walls = [
      { len: lx * 2, dx: 0, dy: +(ly + WALL_T / 2) }, // nord
      { len: lx * 2, dx: 0, dy: -(ly + WALL_T / 2) }, // sud
      { len: ly * 2, dx: -(lx + WALL_T / 2), dy: 0 }, // ouest
      { len: ly * 2, dx: +(lx + WALL_T / 2), dy: 0 }, // est
    ]
    for (let w = 0; w < walls.length; w++) {
      const cfg = walls[w]
      const wp = n
      e(`IFCCARTESIANPOINT((${f(cfg.dx)},${f(cfg.dy)},${zBase.toFixed(4)}));`)
      const wPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wp},$,$);`)
      const wProfPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wp},$,$);`)
      const wProf = n
      e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,'Mur',#${wProfPlc},${f(cfg.len)},${f(WALL_T)});`)
      const wSolidPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wp},$,$);`)
      const wSolid = n
      e(`IFCEXTRUDEDAREASOLID(#${wProf},#${wSolidPlc},#${extDir},${f(height)});`)
      const wReprPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wp},$,$);`)
      const wRepr = n
      e(`IFCSHAPEREPRESENTATION(#${wReprPlc},'Body','SweptSolid',(#${wSolid}));`)
      e(`IFCWALLSTANDARDCASE('${ifcGuid(400 + s * 4 + w)}',$,'Mur ${w + 1} Niveau ${s + 1}',$,$,#${wPlc},#${wRepr},$);`)
      const wallId = n - 1
      e(`IFCRELCONNECTSPATHELEMENTS('${ifcGuid(500 + s * 4 + w)}',$,$,$,$,#${slabId},#${wallId},.,.,.);`)
      wallRefs.push({ id: wallId, dx: cfg.dx, dy: cfg.dy, len: cfg.len, plc: wPlc })
    }

    // Ouvertures du niveau : soustraites des murs via IfcRelVoidsElement.
    // Répartition par tour : ouverture k du niveau s -> mur (s + k) % 4.
    for (let k = 0; k < openings.length; k++) {
      const op = openings[k]
      const wallRef = wallRefs[(s + k) % wallRefs.length]
      // Largeur yn m = ~128px = 0.9 m ; hauteur selon le type.
      const wMeters = op.w / 128 // approximation d'échelle du plan mock
      const hMeters = op.type === 'door' ? OPEN_H_DOOR : OPEN_H_WINDOW
      const oy = 0.15 // z du bas d'ouverture au-dessus de la dalle

      // Profil rectangulaire de l'ouverture
      const opPlace = n
      e(`IFCAXIS2PLACEMENT3D(#${wallRef.plc},$,$);`)
      const opProf = n
      e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,'Ouverture',#${opPlace},${f(Math.max(0.4, wMeters))},${f(wMeters * 0.1)});`)
      const opSolidPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wallRef.plc},$,$);`)
      const opSolid = n
      e(`IFCEXTRUDEDAREASOLID(#${opProf},#${opSolidPlc},#${extDir},${f(hMeters)});`)
      const opReprPlc = n
      e(`IFCAXIS2PLACEMENT3D(#${wallRef.plc},$,$);`)
      const opRepr = n
      e(`IFCSHAPEREPRESENTATION(#${opReprPlc},'Body','SweptSolid',(#${opSolid}));`)
      e(`IFCOPENINGELEMENT('${ifcGuid(600 + s * 16 + k)}',$,'Ouverture ${k + 1} Niveau ${s + 1}',$,$,#${wallRef.plc},#${opRepr},$);`)
      const openingId = n - 1
      e(`IFCRELVOIDSELEMENT('${ifcGuid(700 + s * 16 + k)}',$,$,$,$,#${wallRef.id},#${openingId});`)
    }
  }

  // Toiture: dalle horizontale simple au sommet du bâtiment (maquette construction)
  {
    const ROOF_T = 0.25
    const roofZ = (storeys * height).toFixed(4)
    const rP = n
    e(`IFCCARTESIANPOINT((0.,0.,${roofZ}));`)
    const rPlc = n
    e(`IFCAXIS2PLACEMENT3D(#${rP},$,$);`)
    const rProfPlc = n
    e(`IFCAXIS2PLACEMENT3D(#${rP},$,$);`)
    const rProf = n
    e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,'Toiture',#${rProfPlc},${f(side)},${f(side)});`)
    const rSolidPlc = n
    e(`IFCAXIS2PLACEMENT3D(#${rP},$,$);`)
    const rSolid = n
    e(`IFCEXTRUDEDAREASOLID(#${rProf},#${rSolidPlc},#${extDir},${f(ROOF_T)});`)
    const rReprPlc = n
    e(`IFCAXIS2PLACEMENT3D(#${rP},$,$);`)
    const rRepr = n
    e(`IFCSHAPEREPRESENTATION(#${rReprPlc},'Body','SweptSolid',(#${rSolid}));`)
    e(`IFCSLAB('${ifcGuid(800)}',$,'Toiture',$,$,#${rPlc},#${rRepr},$,.ROOF.,$);`)
    const roofId = n - 1
    // Agrégation : le bâtiment porte aussi la toiture.
    pushAggr(buildingId, [roofId])
  }

  // Programme spatial (IFCSPACE) — point d'origine monde réutilisé (#3).
  const worldPointRef = 3
  const spaceIds = []
  spaceProgram.forEach((sp, i) => {
    e(`IFCSPACE('${ifcGuid(700 + i)}',$,'${esc(sp.name)}',$,$,#${worldPointRef},#${worldPointRef},.,$);`)
    spaceIds.push(n - 1)
  })

  // Agrégations : Projet -> Site ; Site -> Bâtiment ; Bâtiment -> N étages
  // (le bâtiment agrège aussi la toiture, déjà émis avec pushAggr durante
  // sa construction ; les IFCSpace et les étages sont ajoutés ici).
  pushAggr(projectId, [siteId])
  pushAggr(siteId, [buildingId])
  pushAggr(buildingId, storeyIds)
  if (spaceIds.length) pushAggr(buildingId, spaceIds)

  return H.concat(L, aggr, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n'
}

/**
 * Génère la maquette IFC4 en binaire.
 * @returns {Uint8Array}
 */
export function generateIfcModel(spec, openings = []) {
  return new TextEncoder().encode(buildIfcText(spec, openings))
}