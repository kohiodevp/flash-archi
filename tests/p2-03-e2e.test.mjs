// tests/p2-03-e2e.test.mjs
// Tests E2E finaux — Parcours complet d'intégration avec le SDK (version simplifiée et robuste)

process.env.USE_MEMORY_DB = 'true';
process.env.AUTH_ENABLED = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FlashArchiClient, FlashArchiError } from '../sdk/javascript/src/index.js';
import express from 'express';
import http from 'node:http';

describe('P2-03 — SDK Client + Parcours E2E', () => {
  let app;
  let server;
  let port;
  let baseUrl;

  beforeEach(async () => {
    // Fresh app instance for each test
    const { default: importedApp } = await import('../src/app.js');
    app = importedApp;

    // Start server on random port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = address.port;
    baseUrl = `http://127.0.0.1:${port}/api/public/v1`;
  });

  afterEach(async () => {
    if (server) server.close();
  });

  describe('SDK — CRUD projets (core)', () => {
    it('peut créer un projet et récupérer son id et nom', async () => {
      const client = new FlashArchiClient({
        apiKey: 'fa_test_public_pro',
        baseUrl: baseUrl,
      });

      // Créer
      const created = await client.createProject({
        name: 'SDK Test Project',
        prompt: 'Un prompt de test',
        parameters: { test: 123 },
      });
      assert.ok(created.id);
      assert.equal(created.name, 'SDK Test Project');
      // créé ne contient pas prompt ni parameters (c'est voulu par l'API publique)

      // Lire le projet complet via getProject
      const fetched = await client.getProject(created.id);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.name, created.name);
      assert.equal(fetched.prompt, 'Un prompt de test');
      assert.deepEqual(fetched.parameters, { test: 123 });
      assert.ok(fetched.created_at);
      assert.ok(fetched.updated_at);
    });

    it('peut supprimer un projet et obtenir 404 ensuite', async () => {
      const client = new FlashArchiClient({
        apiKey: 'fa_test_public_pro',
        baseUrl: baseUrl,
      });

      // Créer
      const project = await client.createProject({
        name: 'To Delete',
        prompt: 'Prompt',
        parameters: {},
      });

      // Supprimer
      await client.deleteProject(project.id);

      // Vérifier suppression → 404
      try {
        await client.getProject(project.id);
        assert.fail('Devrait lever une erreur 404');
      } catch (err) {
        assert.ok(err instanceof FlashArchiError);
        assert.equal(err.status, 404);
      }
    });
  });

  describe('SDK — Webhooks (base)', () => {
    it('peut créer un webhook et récupérer son id et url', async () => {
      const client = new FlashArchiClient({
        apiKey: 'fa_test_public_pro',
        baseUrl: baseUrl,
      });

      const webhook = await client.createWebhook({
        url: 'https://example.com/webhook',
        events: ['job.completed'],
      });
      assert.ok(webhook.id);
      assert.equal(webhook.url, 'https://example.com/webhook');
      assert.deepEqual(webhook.events, ['job.completed']);
      assert.ok(webhook.secret); // le secret est retourné à la création
    });

    it('peut lister les webhooks', async () => {
      const client = new FlashArchiClient({
        apiKey: 'fa_test_public_pro',
        baseUrl: baseUrl,
      });

      const list = await client.listWebhooks();
      assert.ok(Array.isArray(list.items));
    });
  });

  describe('SDK — Jobs (base)', () => {
    it('peut créer un job et obtenir son id et status', async () => {
      const client = new FlashArchiClient({
        apiKey: 'fa_test_public_pro',
        baseUrl: baseUrl,
      });

      // Utiliser un projet du seed
      const projectId = '00000000-0000-0000-0000-000000000001';

      const job = await client.createJob(projectId, {
        prompt: 'Test prompt for job',
      });
      assert.ok(job.jobId);
      assert.equal(job.status, 'pending'); // dans le mode mémoire, le job reste pending tant que le worker n'est pas lancé
    });
  });
});