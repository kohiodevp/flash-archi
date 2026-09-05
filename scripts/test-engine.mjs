import { generateArchitecture } from '../src/engine.js'

const r = await generateArchitecture('villa 150m² 3 chambres méditerranéen')
console.log('facades north len:', r.facades.north.length)
console.log('facades east len:', r.facades.east.length)
console.log('spec:', JSON.stringify(r.spec))