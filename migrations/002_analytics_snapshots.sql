CREATE TABLE analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, period_type, period_start)
);

-- Index principal pour lookup rapide
CREATE INDEX idx_analytics_snapshots_lookup 
  ON analytics_snapshots(tenant_id, period_type, period_start DESC);

-- Index pour purge automatique
CREATE INDEX idx_analytics_snapshots_purge 
  ON analytics_snapshots(period_type, period_start);

-- RLS activé
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_snapshots_policy ON analytics_snapshots;

CREATE POLICY analytics_snapshots_policy ON analytics_snapshots FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::INTEGER
    AND (
      -- Jours : rétention 90 jours
      (period_type = 'day' AND period_start >= now() - interval '90 days')
      -- Semaines : rétention 52 semaines
      OR (period_type = 'week' AND period_start >= now() - interval '52 weeks')
      -- Mois : illimité
      OR (period_type = 'month')
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::INTEGER);