CREATE TABLE analytics_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,  -- apiKeyPrefix
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'json')),
  file_size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_exports_tenant 
  ON analytics_exports(tenant_id, created_at DESC);

ALTER TABLE analytics_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_exports_policy ON analytics_exports FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::INTEGER)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::INTEGER);