-- migrations/001_project_versions.sql
-- Table for project versioning with RLS

CREATE TABLE project_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    state JSONB NOT NULL,  -- { prompt: String, parameters: Object }
    message TEXT,  -- "Initial version", "Added pool", "Auto-snapshot", "Rollback to v5"
    created_by TEXT NOT NULL,  -- apiKeyPrefix or "system"
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, version_number)
);

-- Index for listing versions of a project (ordered by date descending)
CREATE INDEX idx_project_versions_project_date 
  ON project_versions(project_id, created_at DESC);

-- Index for quick lookup by version number
CREATE INDEX idx_project_versions_project_number 
  ON project_versions(project_id, version_number);

-- Index for automatic purge (find versions > 100 per project)
CREATE INDEX idx_project_versions_purge 
  ON project_versions(project_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE project_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_project_versions_policy ON project_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::INTEGER)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::INTEGER);