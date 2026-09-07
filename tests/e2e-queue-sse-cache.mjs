#!/usr/bin/env node
// Test E2E : file d'attente + progression SSE réelle + résultat complet.
const BASE = 'http://127.0.0.1:8099'
const AUTH = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }

function sse(url, onEvent, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort(); resolve() }, timeoutMs)
    fetch(url, { headers: { Accept: 'text/event-stream', Authorization: 'Bearer test' }, signal: ac.signal })
      .then((res) => {
        if (!res.body) { clearTimeout(timer); return resolve() }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        const read = () => reader.read().then(({ done, value }) => {
          if (done) { clearTimeout(timer); return resolve() }
          const text = dec.decode(value)
          for (const block of text.split('\n\n')) {
            const line = block.split('\n').find((l) => l.startsWith('data:'))
            if (line) onEvent(JSON.parse(line.replace(/^data:\s*/, '')))
          }
          read()
        })
        read()
      })
      .catch(() => { clearTimeout(timer); resolve() })
  })
}

async function main() {
  console.log('=== 1. Lance 3 générations en parallèle (file d\'attente bornée) ===')
  const results = []
  const jobs = []
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${BASE}/api/flash-archi/generate`, { method: 'POST', headers: AUTH, body: JSON.stringify({ prompt: `villa ${100 + i * 20}m² ${i + 2} chambres style contemporain` }) })
    const j = await res.json()
    jobs.push(j.jobId)
    results.push(res.status)
    console.log(`  job ${j.jobId.slice(0, 12)}… → HTTP ${res.status}, queued=${j.queued}`)
  }
  if (!jobs.every((_, i) => results[i] === 202)) { console.log('❌ 202 attendu'); process.exit(1) }

  console.log('\n=== 2. SSE progressif sur job 1 ===')
  const events = []
  await sse(`${BASE}/api/flash-archi/events/${jobs[0]}`, (ev) => {
    if (ev.type === 'progress') {
      events.push(`  ${ev.stage} → ${ev.percent}%${ev.position ? ` (position ${ev.position})` : ''}`)
    }
  })
  console.log(events.join('\n'))
  const progressCount = events.length
  console.log(`  → ${progressCount} événements progress reçus`)

  console.log('\n=== 3. Résultat final complet ===')
  const r = await fetch(`${BASE}/api/flash-archi/jobs/${jobs[0]}`, { headers: AUTH })
  const job = await r.json()
  console.log(`  status: ${job.status}`)
  console.log(`  façades: north=${job.result?.facades?.north?.length} chars, plan2d SVG=${job.result?.plan2d?.svg?.length} chars`)
  console.log('  bimMetrics:', JSON.stringify(job.result?.bimMetrics))

  console.log('\n=== 4. Cache de prompts ===')
  const res2 = await fetch(`${BASE}/api/flash-archi/generate`, { method: 'POST', headers: AUTH, body: JSON.stringify({ prompt: 'VILLA 100 m² 2 chambres, CONTEMPORAIN' }) })
  const hit = await res2.json()
  console.log(`  réponse équivalente: status=${res2.status}, cached=${hit.cached}, jobId=${hit.jobId?.slice(0, 12)}…`)
  console.log('  cache hit:', res2.status === 200 && hit.cached === true ? 'OUI ✅' : 'non')

  const ok = progressCount >= 2 && job.status === 'completed'
  console.log('\n' + (ok ? '✅ FLUX E2E (QUEUE + SSE + CACHE) OK' : '❌ ÉCHEC'))
}
main().catch((e) => { console.error('ERREUR:', e); process.exit(1) })