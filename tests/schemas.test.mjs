// ===========================================================
// Tests — Schémas (Flash-Archi)
// ===========================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FlashSpec,
  FlashPlan2DOutput,
  FlashFacadeOutput,
  FlashArchiResult,
} from '../src/schemas.js'

test('FlashSpec accepte une spécification valide', () => {
  const r = FlashSpec.safeParse({ surface: 150, rooms: 3, style: 'méditerranéen', garage: 'single' })
  assert.equal(r.success, true)
})

test('FlashSpec rejette surface non positive', () => {
  const r = FlashSpec.safeParse({ surface: -5, rooms: 3, style: 'x' })
  assert.equal(r.success, false)
})

test('FlashSpec rejette rooms non entier/positif', () => {
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 0, style: 'x' }).success, false)
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2.5, style: 'x' }).success, false)
})

test('FlashSpec valide le garage enum', () => {
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x', garage: 'double' }).success, true)
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x', garage: 'triple' }).success, false)
})

test('FlashPlan2DOutput exige svg, scale, legend', () => {
  assert.equal(FlashPlan2DOutput.safeParse({ svg: '<svg/>', scale: 50, legend: 'l' }).success, true)
  assert.equal(FlashPlan2DOutput.safeParse({ svg: '<svg/>', scale: 50 }).success, false)
})

test('FlashFacadeOutput exige les 4 orientations', () => {
  assert.equal(FlashFacadeOutput.safeParse({ north: 'a', south: 'b', east: 'c', west: 'd' }).success, true)
  assert.equal(FlashFacadeOutput.safeParse({ north: 'a', south: 'b', east: 'c' }).success, false)
})

test('FlashArchiResult compose spec+plan2d+facades', () => {
  const r = FlashArchiResult.safeParse({
    spec: { surface: 100, rooms: 2, style: 'x' },
    plan2d: { svg: '<svg/>', scale: 50, legend: 'l' },
    facades: { north: 'a', south: 'b', east: 'c', west: 'd' },
  })
  assert.equal(r.success, true)
})

test('FlashSpec définit storeys/hauteur par défaut', () => {
  const r = FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x' })
  assert.equal(r.success, true)
  assert.equal(r.data.storeys, 1)
  assert.equal(r.data.heightPerStorey, 3.0)
})

test('FlashSpec accepte storeys/hauteur et programme spatial', () => {
  const r = FlashSpec.safeParse({
    surface: 200, rooms: 4, style: 'contemporain', storeys: 2,
    heightPerStorey: 2.8,
    spaceProgram: [{ name: 'Salle Ω∑∏', area: 12.5 }],
  })
  assert.equal(r.success, true)
  assert.equal(r.data.storeys, 2)
  assert.equal(r.data.spaceProgram[0].name, 'Salle Ω∑∏')
})

test('FlashSpec rejette storeys non entier ou non positif', () => {
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x', storeys: 0 }).success, false)
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x', storeys: 1.5 }).success, false)
  assert.equal(FlashSpec.safeParse({ surface: 100, rooms: 2, style: 'x', heightPerStorey: -1 }).success, false)
})

test('FlashArchiResult accepte un ifcModel base64 (optionnel)', () => {
  const r = FlashArchiResult.safeParse({
    spec: { surface: 100, rooms: 2, style: 'x' },
    plan2d: { svg: '<svg/>', scale: 50, legend: 'l' },
    facades: { north: 'a', south: 'b', east: 'c', west: 'd' },
    ifcModel: 'data:application/step;base64,UEsDBBQ=',
  })
  assert.equal(r.success, true)
  assert.match(r.data.ifcModel, /^data:application\/step;base64,/)
})

test('FlashArchiResult accepte bimMetrics avec roofArea et totalVolume', () => {
  const r = FlashArchiResult.safeParse({
    spec: { surface: 100, rooms: 2, style: 'x' },
    plan2d: { svg: '<svg/>', scale: 50, legend: 'l' },
    facades: { north: 'a', south: 'b', east: 'c', west: 'd' },
    bimMetrics: {
      footprintArea: 100,
      grossVolume: 300,
      openingCount: 0,
      roofArea: 100,
      totalVolume: 325
    }
  })
  assert.equal(r.success, true)
  const m = r.data.bimMetrics
  assert.equal(m.footprintArea, 100)
  assert.equal(m.grossVolume, 300)
  assert.equal(m.openingCount, 0)
  assert.equal(m.roofArea, 100)
  assert.equal(m.totalVolume, 325)
})