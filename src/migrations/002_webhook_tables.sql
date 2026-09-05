-- src/migrations/002_webhook_tables.sql
-- Migration pour les tables de webhooks (P2-03)
-- Ce fichier est destiné à être exécuté par le script de migration (scripts/migrate.js)
-- Il crée les tables webhook_subscriptions et webhook_deliveries avec RLS et les index nécessaires.

-- Note: Ce schéma suppose l'existence d'une table `tenants` (avec id UUID) fournie par P1-01.
-- En mode standalone (USE_MEMORY_DB=true), ce fichier n'est pas exécuté directement ;
-- la logique est implémentée dans src/middleware/db.js (memory store).

-- Création de la table webhook_subscriptions
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Création de la table webhook_deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_attempt_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Activation du RLS sur les deux tables (à faire après la création des tables)
-- Note: Le RLS nécessite que l'extension soit activée et que la politique soit définie.
-- Nous supposons que le middleware DB exécutera `SET LOCAL app.tenant_id = $1` pour les requêtes.
-- Ainsi, nous définissons des politiques qui utilisent `current_setting('app.tenant_id')::uuid` pour filtrer.

-- Politique pour webhook_subscriptions : un tenant ne peut voir que ses propres subscriptions
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_subscriptions_tenant_isolation ON webhook_subscriptions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Politique pour webhook_deliveries : un tenant ne peut voir que les deliveries de ses propres subscriptions
-- Nous devons joindre avec webhook_subscriptions pour obtenir le tenant_id de la subscription.
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  USING (
    EXISTS (
      SELECT 1 FROM webhook_subscriptions
      WHERE id = subscription_id
      AND tenant_id = current_setting('app.tenant_id')::uuid
    )
  );

-- Index pour améliorer les performances
-- Index sur webhook_subscriptions.tenant_id pour les recherches par tenant
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_id ON webhook_subscriptions(tenant_id);
-- Index GIN sur le tableau events pour les recherches par type d'événement
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_events ON webhook_subscriptions USING GIN(events);
-- Index sur webhook_deliveries pour le worker de retry : chercher les livraisons en attente dont le prochain essai est dû
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(status, next_attempt_at)
  WHERE status = 'pending';
-- Index sur webhook_deliveries.subscription_id pour les recherches par subscription
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_id ON webhook_deliveries(subscription_id);