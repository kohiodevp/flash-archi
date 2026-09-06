// src/newsletter.js — pré-inscription au lancement du paiement (V1)
//
// Stocke les inscriptions dans un fichier JSON dans le volume de données
// (/app/data/newsletter.json). Simple et robuste pour une V1 ; le passage
// à une table `newsletter` (Postgres/multi-tenant) se fera en V2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : config.db.path;
const FILE = path.join(DATA_DIR, 'newsletter.json');

// Charge le tableau existant (ou initialise).
function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // fichier corrompu → on repart sur un tableau vide (sans écraser)
  }
}

// Enregistre une inscription.
// - Déduplique par email (une seule entrée, mise à jour du plan/message).
// - Valide le format de l'email (simple) et le plan.
function subscribe({ email, plan, message }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const err = new Error('Adresse email invalide');
    err.status = 400;
    throw err;
  }

  const validPlan = /^(pro|enterprise)$/i.test(plan ?? '')
    ? String(plan).toLowerCase()
    : 'pro';
  const cleanMessage = String(message || '').trim();

  const entries = load();
  const existing = entries.find((e) => e.email === normalizedEmail);
  const record = {
    email: normalizedEmail,
    plan: validPlan,
    message: cleanMessage,
    subscribedAt: new Date().toISOString(),
  };

  if (existing) {
    Object.assign(existing, { plan: validPlan, message: cleanMessage, updatedAt: new Date().toISOString() });
  } else {
    entries.push(record);
  }

  // Écriture atomique (tmp + rename) pour ne jamais laisser un fichier à moitié écrit.
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, FILE);

  return { email: normalizedEmail, plan: validPlan, subscribed: !existing };
}

// Retourne toutes les inscriptions (usage interne / tests).
function list() {
  return load();
}

export { subscribe, list, FILE as newsletterFile };