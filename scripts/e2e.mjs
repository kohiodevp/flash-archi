const BASE = 'http://localhost:8111'
const j = (r) => r.json()

// Health
const health = await j(await fetch(`${BASE}/health`))
console.log('HEALTH OK:', health.api === 'ok', '| provider:', health.provider)

// generate
const gen = await j(await fetch(`${BASE}/api/flash-archi/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'maison 180m² 4 chambres provençal avec garage double' }),
}))
console.log('GENERATE 202:', gen.jobId ? 'job created' : 'MISSING', '| status:', gen.status)
const jobId = gen.jobId

// jobs/:id (wait for completion)
for (let i = 0; i < 10; i++) {
  const job = await j(await fetch(`${BASE}/api/flash-archi/jobs/${jobId}`))
  if (job.status === 'completed' || job.status === 'failed') {
    console.log('JOB status:', job.status)
    console.log('JOB spec surface:', job.result?.spec?.surface, 'rooms:', job.result?.spec?.rooms, 'style:', job.result?.spec?.style, 'garage:', job.result?.spec?.garage)
    console.log('JOB has plan2d.svg:', !!job.result?.plan2d?.svg, '| scale:', job.result?.plan2d?.scale)
    console.log('JOB facades north len:', job.result?.facades?.north?.length, 'west len:', job.result?.facades?.west?.length)
    break
  }
  await new Promise((r) => setTimeout(r, 300))
}

// validation error case
const bad = await fetch(`${BASE}/api/flash-archi/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '' }),
})
console.log('EMPTY PROMPT -> status', bad.status, 'expected 400')
const jbad = await j(bad)
console.log('  error field present:', !!jbad.error)

// 404
const nf = await fetch(`${BASE}/api/flash-archi/jobs/job_nonexistent`)
console.log('UNKNOWN JOB -> status', nf.status, 'expected 404')