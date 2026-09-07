#!/usr/bin/env node
// Script de test E2E du flux Orange Money (mode simulation).
// Utilise uniquement fetch (pas de dépendances).
const BASE = 'http://127.0.0.1:8099';
const AUTH = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' };

async function main() {
  // 1. Créer un paiement PRO
  console.log('=== 1. create payment (plan pro) ===');
  const createRes = await fetch(`${BASE}/api/payment/create`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ amount: 17400, description: 'Plan Pro 50 gen', userId: 'test-key', plan: 'pro', phone: '+22670123456', email: 'demo2@test.bf' }),
  });
  const create = await createRes.json();
  console.log('HTTP', createRes.status, JSON.stringify(create));
  const orderId = create.orderId;

  // On extrait le token simulé depuis l'URL
  let simToken = null;
  if (create.paymentUrl) {
    const u = new URL(create.paymentUrl);
    simToken = u.searchParams.get('token');
  }
  console.log('orderId:', orderId, '| simToken:', simToken);

  // 2. Vérifier le statut (mode sim -> SUCCESSFUL par défaut, active le plan)
  console.log('\n=== 2. status check (pending -> accepted) ===');
  const stRes = await fetch(`${BASE}/api/payment/status/${orderId}`, { headers: AUTH });
  const st = await stRes.json();
  console.log('HTTP', stRes.status, JSON.stringify(st));

  // 3. Vérifier le compte (quota 50, plan pro)
  console.log('\n=== 3. account (pro, quota 50) ===');
  const accRes = await fetch(`${BASE}/api/payment/account/test-key`, { headers: AUTH });
  const acc = await accRes.json();
  console.log('HTTP', accRes.status, JSON.stringify(acc));
  if (acc.quota?.plan !== 'pro' || acc.quota?.quotaRemaining !== 50) {
    console.log('ERREUR: la mise à niveau PRO n.a pas eu lieu');
    process.exit(1);
  }

  // 4. Consommer le quota via /generate (user-demo-2 existe -> décompte)
  console.log('\n=== 4. generate consomme 1 quota ===');
  const genRes = await fetch(`${BASE}/api/flash-archi/generate`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ prompt: 'Villa 120m2' }),
  });
  const gen = await genRes.json();
  console.log('HTTP', genRes.status, JSON.stringify(gen));
  const quotaAfter = await (await fetch(`${BASE}/api/payment/account/test-key`, { headers: AUTH })).json();
  console.log('quota après génération:', quotaAfter.quota.quotaRemaining, '(attendu 49)');
  if (quotaAfter.quota.quotaRemaining !== 49) {
    console.log('ERREUR: quota non décompté');
    process.exit(1);
  }

  console.log('\n✅ FLUX E2E ORANGE MONEY (SIM) OK');
}

main().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });