// src/middleware/memory-query.js
import { randomUUID } from 'node:crypto';

/**
 * Executes a SQL query in memory using the provided state.
 * @param {Object} state - Object containing all necessary collections (projects, versions, etc.)
 * @param {string} text - SQL string to execute
 * @param {Array} params - Array of parameters
 * @returns {Object} Result in the form { rows: [...], rowCount: N }
 */
export function executeMemoryQuery(state, text, params) {
  const q = text.replace(/\s+/g, ' ').trim();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const param = (i) => params[i - 1];
  const {
    projects,
    versions,
    sessions,
    webhookSubscriptions,
    webhookDeliveries,
    analytics_snapshots,
    tenant_analytics_config,
    analytics_exports
  } = state;

  // --- projets ---
  if (q.startsWith(norm('SELECT prompt, parameters FROM projects WHERE id = $1'))) {
    const p = projects.get(param(1));
    return p
      ? { rows: [{ prompt: p.prompt, parameters: p.parameters }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('UPDATE projects SET prompt = $1, parameters = $2, updated_at = now() WHERE id = $3'))) {
    const p = projects.get(param(3));
    if (p) {
      p.prompt = param(1);
      p.parameters = JSON.parse(param(2));
      p.updated_at = new Date();
    }
    return { rows: [], rowCount: p ? 1 : 0 };
  }
  if (q.startsWith(norm('SELECT id, name, prompt, parameters, tenant_id, created_by, created_at, updated_at FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC'))) {
    const list = [...projects.values()]
      .filter((p) => p.tenant_id === param(1))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(param(3), param(3) + param(2));
    return { rows: list, rowCount: list.length };
  }
  if (q.startsWith(norm('INSERT INTO projects (id, name, prompt, parameters, tenant_id, created_by)'))) {
    const id = param(1);
    const p = {
      id,
      name: param(2),
      prompt: param(3),
      parameters: JSON.parse(param(4)),
      tenant_id: param(5),
      created_by: param(6),
      created_at: new Date(),
      updated_at: new Date(),
    };
    projects.set(id, p);
    return { rows: [p], rowCount: 1 };
  }
  if (q.startsWith(norm('SELECT id, name, prompt, parameters, tenant_id, created_by, created_at, updated_at FROM projects WHERE id = $1 AND tenant_id = $2'))) {
    const p = projects.get(param(1));
    if (p && p.tenant_id === param(2)) {
      return { rows: [p], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2'))) {
    const p = projects.get(param(1));
    if (p && p.tenant_id === param(2)) {
      return { rows: [{ id: p.id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('DELETE FROM projects WHERE id = $1 AND tenant_id = $2'))) {
    const p = projects.get(param(1));
    if (p && p.tenant_id === param(2)) {
      projects.delete(param(1));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  // --- session collaborative active ? ---
  if (q.startsWith(norm('SELECT COUNT(*) AS count FROM collaborative_sessions WHERE project_id = $1'))) {
    const count = sessions.filter((s) => s.project_id === param(1)).length;
    return { rows: [{ count }], rowCount: 1 };
  }
  // --- versions ---
  if (q.includes('AS next_version')) {
    const rows = versions.filter((v) => v.project_id === param(1));
    const next = rows.length === 0 ? 1 : Math.max(...rows.map((v) => v.version_number)) + 1;
    return { rows: [{ next_version: next }], rowCount: 1 };
  }
  if (q.startsWith(norm('INSERT INTO project_versions (project_id, tenant_id, version_number, state, message, created_by)'))) {
    const v = {
      id: randomUUID(),
      project_id: param(1),
      tenant_id: param(2),
      version_number: param(3),
      state: param(4),
      message: param(5),
      created_by: param(6),
      created_at: new Date(),
    };
    versions.push({ ...v, state: JSON.parse(v.state) });
    return {
      rows: [{ id: v.id, version_number: v.version_number, state: v.state, message: v.message, created_by: v.created_by, created_at: v.created_at }],
      rowCount: 1,
    };
  }
  if (q.includes('AND project_id = $2') && q.includes('version_number, state, message')) {
    const v = versions.find((x) => x.id === param(1) && x.project_id === param(2));
    if (!v) return { rows: [], rowCount: 0 };
    return { rows: [{ id: v.id, version_number: v.version_number, state: JSON.stringify(v.state), message: v.message, created_by: v.created_by, created_at: v.created_at }], rowCount: 1 };
  }
  if (q.includes('AND project_id = $2') && q.includes('SELECT state, version_number')) {
    const v = versions.find((x) => x.id === param(1) && x.project_id === param(2));
    if (!v) return { rows: [], rowCount: 0 };
    return { rows: [{ state: v.state, version_number: v.version_number }], rowCount: 1 };
  }
  if (q.startsWith(norm('SELECT id, version_number, message, created_by, created_at FROM project_versions WHERE project_id = $1'))) {
    const list = versions
      .filter((v) => v.project_id === param(1))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(param(3), param(3) + param(2));
    return { rows: list.map((v) => ({ id: v.id, version_number: v.version_number, message: v.message, created_by: v.created_by, created_at: v.created_at })), rowCount: list.length };
  }
  if (q.startsWith(norm('SELECT COUNT(*) AS total FROM project_versions WHERE project_id = $1'))) {
    const total = versions.filter((v) => v.project_id === param(1)).length;
    return { rows: [{ total }], rowCount: 1 };
  }
  if (q.startsWith('DELETE FROM project_versions WHERE id IN')) {
    // TODO: implement if necessary
    return { rows: [], rowCount: 0 };
  }
  // --- webhook_subscriptions (P2-03) ---
  if (q.startsWith(norm('SELECT id, url, events, active, created_at, updated_at FROM webhook_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC'))) {
    const list = [...webhookSubscriptions.values()]
      .filter((sub) => sub.tenant_id === param(1))
      .sort((a, b) => b.created_at - a.created_at);
    return { rows: list.map((sub) => ({ id: sub.id, url: sub.url, events: sub.events, active: sub.active, created_at: sub.created_at, updated_at: sub.updated_at })), rowCount: list.length };
  }
  if (q.startsWith(norm('INSERT INTO webhook_subscriptions (id, tenant_id, url, events, secret, created_by)'))) {
    const id = param(1);
    const sub = {
      id,
      tenant_id: param(2),
      url: param(3),
      events: param(4),
      secret: param(5),
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    webhookSubscriptions.set(id, sub);
    return { rows: [{ id: sub.id, url: sub.url, events: sub.events, secret: sub.secret, active: sub.active, created_at: sub.created_at, updated_at: sub.updated_at }], rowCount: 1 };
  }
  if (q.startsWith(norm('SELECT id, url, events, active, created_at, updated_at FROM webhook_subscriptions WHERE id = $1 AND tenant_id = $2'))) {
    const sub = webhookSubscriptions.get(param(1));
    if (sub && sub.tenant_id === param(2)) {
      return { rows: [{ id: sub.id, url: sub.url, events: sub.events, active: sub.active, created_at: sub.created_at, updated_at: sub.updated_at }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.includes('UPDATE webhook_subscriptions SET') && q.includes('WHERE tenant_id = $') && q.includes('AND id = $')) {
    const idParam = param(params.length);
    const tenantParam = param(params.length - 1);
    const sub = webhookSubscriptions.get(idParam);
    if (sub && sub.tenant_id === tenantParam) {
      const urlIdx = q.match(/url = \$(\d+)/)?.[1];
      const eventsIdx = q.match(/events = \$(\d+)/)?.[1];
      const activeIdx = q.match(/active = \$(\d+)/)?.[1];
      if (urlIdx) sub.url = param(Number(urlIdx));
      if (eventsIdx) sub.events = param(Number(eventsIdx));
      if (activeIdx) sub.active = param(Number(activeIdx));
      sub.updated_at = new Date();
      return { rows: [{ id: sub.id, url: sub.url, events: sub.events, active: sub.active, created_at: sub.created_at, updated_at: sub.updated_at }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('DELETE FROM webhook_subscriptions WHERE id = $1 AND tenant_id = $2'))) {
    if (webhookSubscriptions.has(param(1))) {
      const sub = webhookSubscriptions.get(param(1));
      if (sub && sub.tenant_id === param(2)) {
        webhookSubscriptions.delete(param(1));
        return { rows: [], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  // --- webhook_deliveries (P2-03) ---
  if (q.startsWith(norm('SELECT id, url, secret FROM webhook_subscriptions WHERE tenant_id = $1 AND active = TRUE AND $2 = ANY(events)'))) {
    const rows = [...webhookSubscriptions.values()]
      .filter((sub) => sub.tenant_id === param(1) && sub.active && sub.events.includes(param(2)))
      .map((sub) => ({ id: sub.id, url: sub.url, secret: sub.secret }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith(norm('INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload, status, attempts, created_at, updated_at)'))) {
    const id = param(1);
    const del = {
      id,
      subscription_id: param(2),
      event_type: param(3),
      payload: param(4),
      status: 'pending',
      attempts: 0,
      created_at: new Date(),
      updated_at: new Date(),
      next_attempt_at: null,
    };
    webhookDeliveries.set(id, del);
    return { rows: [del], rowCount: 1 };
  }
  if (q.startsWith(norm('SELECT d.id, d.event_type, d.payload, d.attempts, s.id AS subscription_id, s.url, s.secret FROM webhook_deliveries d JOIN webhook_subscriptions s ON d.subscription_id = s.id WHERE d.status = \'pending\' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW()) AND s.active = TRUE LIMIT 50'))) {
    const rows = [...webhookDeliveries.values()]
      .filter((del) => {
        const sub = webhookSubscriptions.get(del.subscription_id);
        return del.status === 'pending' && sub && sub.active;
      })
      .map((del) => {
        const sub = webhookSubscriptions.get(del.subscription_id);
        return {
          id: del.id,
          event_type: del.event_type,
          payload: del.payload,
          attempts: del.attempts,
          subscription_id: del.subscription_id,
          url: sub ? sub.url : null,
          secret: sub ? sub.secret : null,
        };
      });
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith(norm('UPDATE webhook_deliveries SET status = \'success\', attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW() WHERE id = $1'))) {
    const del = webhookDeliveries.get(param(1));
    if (del) {
      del.status = 'success';
      del.attempts = (del.attempts || 0) + 1;
      del.last_attempt_at = new Date();
      del.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('SELECT d.id, d.event_type, d.payload, d.attempts FROM webhook_deliveries d JOIN webhook_subscriptions s ON d.subscription_id = s.id WHERE s.tenant_id = $1 AND d.status = \'pending\''))) {
    const rows = [...webhookDeliveries.values()]
      .filter((del) => {
        const sub = webhookSubscriptions.get(del.subscription_id);
        return sub && sub.tenant_id === param(1) && del.status === 'pending';
      })
      .map((del) => ({ id: del.id, event_type: del.event_type, payload: del.payload, attempts: del.attempts }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith(norm('SELECT d.status FROM webhook_deliveries d JOIN webhook_subscriptions s ON d.subscription_id = s.id WHERE s.tenant_id = $1 AND d.status = \'pending\''))) {
    const rows = [...webhookDeliveries.values()]
      .filter((del) => {
        const sub = webhookSubscriptions.get(del.subscription_id);
        return sub && sub.tenant_id === param(1) && del.status === 'pending';
      })
      .map((del) => ({ status: del.status }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith(norm('DELETE FROM webhook_deliveries WHERE status IN (\'success\', \'failed\') AND updated_at < NOW() - INTERVAL \'7 days\''))) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const count = [...webhookDeliveries.values()].filter((del) => {
      del.updated_at < sevenDaysAgo && (del.status === 'success' || del.status === 'failed');
    }).length;
    return { rows: [], rowCount: count };
  }
  // --- analytics_snapshots ---
  if (q.startsWith(norm('SELECT id, tenant_id, period_type, period_start, period_end, metrics, created_at FROM analytics_snapshots WHERE tenant_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3'))) {
    const list = analytics_snapshots.filter(s => s.tenant_id === param(1));
    return { rows: list, rowCount: list.length };
  }
  if (q.startsWith(norm('INSERT INTO analytics_snapshots (id, tenant_id, period_type, period_start, period_end, metrics) VALUES ($1, $2, $3, $4, $5, $6)'))) {
    const snap = {
      id: param(1),
      tenant_id: param(2),
      period_type: param(3),
      period_start: param(4),
      period_end: param(5),
      metrics: JSON.parse(param(6)),
      created_at: new Date()
    };
    analytics_snapshots.push(snap);
    return { rows: [snap], rowCount: 1 };
  }
  if (q.startsWith(norm('SELECT COUNT(*) AS total FROM analytics_snapshots WHERE tenant_id = $1'))) {
    const total = analytics_snapshots.filter(s => s.tenant_id === param(1)).length;
    return { rows: [{ total }], rowCount: 1 };
  }
  // --- tenant_analytics_config ---
  if (q.startsWith(norm('SELECT * FROM tenant_analytics_config WHERE tenant_id = $1'))) {
    const config = tenant_analytics_config.get(param(1));
    if (config) {
      return { rows: [config], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (q.startsWith(norm('INSERT INTO tenant_analytics_config (tenant_id, cost_threshold_usd, error_rate_threshold, queue_depth_threshold, alert_email_enabled, alert_webhook_enabled, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id) DO UPDATE SET cost_threshold_usd = EXCLUDED.cost_threshold_usd, error_rate_threshold = EXCLUDED.error_rate_threshold, queue_depth_threshold = EXCLUDED.queue_depth_threshold, alert_email_enabled = EXCLUDED.alert_email_enabled, alert_webhook_enabled = EXCLUDED.alert_webhook_enabled, updated_at = EXCLUDED.updated_at'))) {
    const config = {
      tenant_id: param(1),
      cost_threshold_usd: param(2),
      error_rate_threshold: param(3),
      queue_depth_threshold: param(4),
      alert_email_enabled: param(5),
      alert_webhook_enabled: param(6),
      updated_at: param(7) instanceof Date ? param(7) : new Date(param(7))
    };
    tenant_analytics_config.set(param(1), config);
    return { rows: [config], rowCount: 1 };
  }
  // --- analytics_exports ---
  if (q.startsWith(norm('SELECT id, tenant_id, requested_by, period_start, period_end, format, file_size_bytes, created_at FROM analytics_exports WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3'))) {
    const list = analytics_exports.filter(e => e.tenant_id === param(1)).sort((a, b) => b.created_at - a.created_at).slice(param(2), param(2) + param(3));
    return { rows: list, rowCount: list.length };
  }
  if (q.startsWith(norm('INSERT INTO analytics_exports (id, tenant_id, requested_by, period_start, period_end, format, file_size_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)'))) {
    const exp = {
      id: param(1),
      tenant_id: param(2),
      requested_by: param(3),
      period_start: param(4),
      period_end: param(5),
      format: param(6),
      file_size_bytes: param(7),
      created_at: new Date()
    };
    analytics_exports.push(exp);
    return { rows: [exp], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}
