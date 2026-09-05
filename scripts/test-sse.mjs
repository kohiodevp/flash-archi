// SSE events test — subscribe and verify we receive completion events.
const BASE = 'http://localhost:8111'

const gen = await (await fetch(`${BASE}/api/flash-archi/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'appartement 90m² 2 chambres' }),
})).json()
const jobId = gen.jobId
console.log('jobId:', jobId)

const res = await fetch(`${BASE}/api/flash-archi/events/${jobId}`)
console.log('SSE content-type:', res.headers.get('content-type'))
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
let events = 0
const timeout = setTimeout(() => { console.log('TIMEOUT — forced close'); reader.cancel() }, 8000)
try {
  while (events < 3 && buf.indexOf('completed') === -1) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // parse complete frames
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (frame.startsWith('data: ')) {
        const payload = JSON.parse(frame.replace(/^data: /, ''))
        events++
        console.log('SSE event:', JSON.stringify({ type: payload.type, status: payload.status, hasResult: !!payload.result, hasError: !!payload.error }))
      }
    }
  }
} finally {
  clearTimeout(timeout)
  await reader.cancel()
}
console.log('SSE events received:', events)
if (events === 0) { console.log('FAIL: no SSE events'); process.exit(1) }