// tests/unit/versioning.test.mjs
// Tests unitaires du module de versioning (P2-02).
// Les fonctions prennent un objet `db` (client pg mocké) en paramètre.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createManualVersion,
  listVersions,
  getVersion,
  rollbackToVersion,
  compareVersions,
  createAutoVersion,
  purgeOldVersions,
} from '../../src/versioning.js';

// Fabrique un client db mocké avec des réponses séquentielles sur .query().
function makeDb(sequence) {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sequence.length === 0) {
        return { rows: [], rowCount: 0 };
      }
      const next = sequence.shift();
      if (typeof next === 'function') return next(sql, params);
      return next;
    },
  };
  db.__calls = calls;
  return db;
}

describe('createManualVersion', () => {
  it('crée une version manuelle avec le numéro suivant', async () => {
    const db = makeDb([
      { rows: [{ prompt: 'Maison 120m²', parameters: { levels: 1 } }], rowCount: 1 },
      { rows: [{ next_version: 3 }] },
      { rows: [{ id: 'v3', version_number: 3, state: '{}', message: 'Ajout piscine', created_by: 'abc123', created_at: new Date('2026-01-01') }] },
    ]);
    const v = await createManualVersion('p1', 7, 'Ajout piscine', 'abc123', db);
    assert.equal(v.version_number, 3);
    assert.equal(v.message, 'Ajout piscine');
    assert.equal(v.created_by, 'abc123');
    assert.equal(db.__calls.length, 3);
  });

  it('lève une erreur si le projet est introuvable', async () => {
    const db = makeDb([{ rows: [], rowCount: 0 }]);
    await assert.rejects(
      () => createManualVersion('pNope', 7, 'msg', 'abc', db),
      /Project not found/
    );
  });

  it('lève une erreur si un paramètre requis manque', async () => {
    const db = makeDb([]);
    await assert.rejects(() => createManualVersion(null, 7, 'msg', 'abc', db), /Missing required/);
  });
});

describe('listVersions', () => {
  it('retourne les versions paginées + total', async () => {
    const db = makeDb([
      {
        rows: [
          { id: 'v2', version_number: 2, message: 'm2', created_by: 'u2', created_at: new Date('2026-01-02') },
          { id: 'v1', version_number: 1, message: 'm1', created_by: 'u1', created_at: new Date('2026-01-01') },
        ],
      },
      { rows: [{ total: 2 }] },
    ]);
    const res = await listVersions('p1', 7, 10, 0, db);
    assert.equal(res.versions.length, 2);
    assert.equal(res.versions[0].versionNumber, 2);
    assert.equal(res.total, 2);
    assert.equal(res.limit, 10);
  });
});

describe('getVersion', () => {
  it('retourne une version avec state parsé', async () => {
    const db = makeDb([
      {
        rows: [{
          id: 'v1', version_number: 1,
          state: JSON.stringify({ prompt: 'P', parameters: { levels: 2 } }),
          message: 'm', created_by: 'u', created_at: new Date('2026-01-01'),
        }],
        rowCount: 1,
      },
    ]);
    const v = await getVersion('p1', 'v1', 7, db);
    assert.equal(v.versionNumber, 1);
    assert.deepEqual(v.state, { prompt: 'P', parameters: { levels: 2 } });
  });

  it('retourne null si introuvable', async () => {
    const db = makeDb([{ rows: [], rowCount: 0 }]);
    const v = await getVersion('p1', 'vx', 7, db);
    assert.equal(v, null);
  });
});

describe('rollbackToVersion', () => {
  it('restaure et crée une version de rollback quand aucune session active', async () => {
    const db = makeDb([
      { rows: [{ count: 0 }] },
      { rows: [{ state: JSON.stringify({ prompt: 'P', parameters: { levels: 1 } }), version_number: 5 }], rowCount: 1 },
      { rows: [] }, // UPDATE projects
      // createManualVersion interne :
      { rows: [{ prompt: 'P', parameters: { levels: 1 } }], rowCount: 1 }, // SELECT projet
      { rows: [{ next_version: 6 }] }, // SELECT max version
      { rows: [{ id: 'v6', version_number: 6, state: '{}', message: 'Rollback to version 5', created_by: 'abc', created_at: new Date() }] }, // INSERT
    ]);
    const res = await rollbackToVersion('p1', 'v5', 7, 'abc', db);
    assert.equal(res.message, 'Project restored to version 5');
    assert.equal(res.newVersion.version_number, 6);
    assert.match(res.newVersion.message, /Rollback to version 5/);
  });

  it('bloque si collaboration active', async () => {
    const db = makeDb([{ rows: [{ count: 2 }] }]);
    await assert.rejects(
      () => rollbackToVersion('p1', 'v5', 7, 'abc', db),
      /Cannot rollback while users are editing/
    );
  });

  it('lève si la version cible est introuvable', async () => {
    const db = makeDb([
      { rows: [{ count: 0 }] },
      { rows: [], rowCount: 0 },
    ]);
    await assert.rejects(() => rollbackToVersion('p1', 'vx', 7, 'abc', db), /Version not found/);
  });
});

describe('compareVersions', () => {
  it('détecte les différences de prompt et de paramètres', () => {
    const a = {
      id: 'a', version_number: 1,
      state: { prompt: 'old', parameters: { levels: 1, style: 'moderne' } },
    };
    const b = {
      id: 'b', version_number: 2,
      state: { prompt: 'new', parameters: { levels: 2, style: 'moderne' } },
    };
    const res = compareVersions(a, b);
    assert.ok(res.diff.prompt, 'prompt diff present');
    assert.equal(res.diff.prompt.old, 'old');
    assert.equal(res.diff.prompt.new, 'new');
    assert.ok(res.diff.parameters.levels, 'levels diff present');
    assert.equal(res.diff.parameters.levels.old, 1);
    assert.equal(res.diff.parameters.levels.new, 2);
    assert.equal(res.diff.parameters.style, undefined, 'identical param absent');
  });

  it('retourne un diff vide si les versions sont identiques', () => {
    const a = { id: 'a', version_number: 1, state: { prompt: 'x', parameters: { levels: 1 } } };
    const b = { id: 'b', version_number: 2, state: { prompt: 'x', parameters: { levels: 1 } } };
    const res = compareVersions(a, b);
    assert.equal(res.diff.prompt, undefined);
    assert.equal(res.diff.parameters, undefined);
  });
});

describe('createAutoVersion', () => {
  it('crée un snapshot système', async () => {
    const db = makeDb([
      { rows: [{ prompt: 'P', parameters: { levels: 2 } }], rowCount: 1 },
      { rows: [{ next_version: 4 }] },
      { rows: [{ id: 'v4', version_number: 4, state: '{}', message: 'Auto-snapshot', created_by: 'system', created_at: new Date() }] },
    ]);
    const v = await createAutoVersion('p1', 7, db);
    assert.equal(v.version_number, 4);
    assert.equal(v.message, 'Auto-snapshot');
    assert.equal(v.created_by, 'system');
  });
});

describe('purgeOldVersions', () => {
  it('exécute la purge et retourne le nombre de lignes supprimées', async () => {
    const db = makeDb([{ rows: [], rowCount: 12 }]);
    const n = await purgeOldVersions(db);
    assert.equal(n, 12);
  });
});