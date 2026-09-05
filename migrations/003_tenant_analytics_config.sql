CREATE TABLE tenant_analytics_config (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  cost_threshold_usd NUMERIC NOT NULL DEFAULT 100,
  error_rate_threshold NUMERIC NOT NULL DEFAULT 0.05,
  queue_depth_threshold INTEGER NOT NULL DEFAULT 100,
  alert_email_enabled BOOLEAN NOT NULL DEFAULT true,
  alert_webhook_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed automatique à la création d'un tenant (trigger)
-- Valeurs par défaut par plan (documentées pour les mainteneurs) :
-- ┌─────────────┬──────────────────┬──────────────┬───────────────┐
-- │ Plan        │ Cost threshold   │ Error rate   │ Queue depth   │
-- ├─────────────┼──────────────────┼──────────────┼───────────────┤
-- │ Free        │ $50/mois         │ 5%           │ 50 jobs       │
-- │ Pro         │ $200/mois        │ 5%           │ 100 jobs      │
-- │ Enterprise  │ $2000/mois       │ 3%           │ 500 jobs      │
-- │ Défaut      │ $100/mois        │ 5%           │ 100 jobs      │
-- └─────────────┴──────────────────┴──────────────┴───────────────┘
CREATE OR REPLACE FUNCTION create_default_analytics_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_analytics_config (
    tenant_id,
    cost_threshold_usd,
    error_rate_threshold,
    queue_depth_threshold
  ) VALUES (
    NEW.id,
    CASE NEW.plan 
      WHEN 'free' THEN 50
      WHEN 'pro' THEN 200
      WHEN 'enterprise' THEN 2000
      ELSE 100
    END,
    CASE NEW.plan WHEN 'enterprise' THEN 0.03 ELSE 0.05 END,
    CASE NEW.plan WHEN 'enterprise' THEN 500 ELSE 100 END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_analytics_config
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION create_default_analytics_config();

-- RLS activé
ALTER TABLE tenant_analytics_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_analytics_config_policy ON tenant_analytics_config FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::INTEGER)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::INTEGER);