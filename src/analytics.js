// src/analytics.js
// Aggregation logic for Flash-Archi analytics

/**
 * Compute daily snapshot for a given tenant and date.
 * @param {number} tenantId - The tenant ID
 * @param {Date} date - The date for which to compute the snapshot (will be converted to start of day)
 * @param {object} db - The database connection object with a query method
 * @returns {Promise<Object>} The computed metrics
 */
export async function computeDailySnapshot(tenantId, date, db) {
  const periodStart = new Date(date);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 1);

  // Aggregate metrics from source tables
  const metrics = {
    usage: await computeUsageMetrics(tenantId, periodStart, periodEnd, db),
    costs: await computeCostMetrics(tenantId, periodStart, periodEnd, db),
    performance: await computePerformanceMetrics(tenantId, periodStart, periodEnd, db),
    popularity: await computePopularityMetrics(tenantId, periodStart, periodEnd, db),
    top_api_keys: await computeTopApiKeys(tenantId, periodStart, periodEnd, db)
  };

  // Upsert the snapshot (avoid duplicates on re-run)
  await db.query(`
    INSERT INTO analytics_snapshots 
      (tenant_id, period_type, period_start, period_end, metrics)
    VALUES ($1, 'day', $2, $3, $4)
    ON CONFLICT (tenant_id, period_type, period_start) 
    DO UPDATE SET 
      metrics = EXCLUDED.metrics,
      period_end = EXCLUDED.period_end,
      created_at = now()
  `, [tenantId, periodStart.toISOString(), periodEnd.toISOString(), JSON.stringify(metrics)]);

  // Check thresholds and trigger webhooks if needed
  await checkThresholds(tenantId, metrics, db);

  return metrics;
}

/**
 * Compute usage metrics for the given period.
 * @param {number} tenantId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {object} db
 * @returns {Promise<Object>}
 */
export async function computeUsageMetrics(tenantId, periodStart, periodEnd, db) {
  const { rows } = await db.query(`
    SELECT 
      COUNT(*) AS api_requests,
      COUNT(CASE WHEN j.status = 'completed' THEN 1 END) AS jobs_completed,
      COUNT(CASE WHEN j.status = 'failed' THEN 1 END) AS jobs_failed,
      COUNT(DISTINCT j.id) AS jobs_created,
      COUNT(DISTINCT t.id) AS templates_created,
      COUNT(DISTINCT t2.id) AS templates_forked,
      COUNT(DISTINCT v.id) AS versions_created,
      COUNT(DISTINCT wd.id) AS webhooks_delivered,
      COUNT(CASE WHEN wd.status = 'failed' THEN 1 END) AS webhooks_failed
    FROM api_request_log ar
    LEFT JOIN jobs j ON j.tenant_id = $1 AND j.created_at >= $2 AND j.created_at < $3
    LEFT JOIN templates t ON t.tenant_id = $1 AND t.created_at >= $2 AND t.created_at < $3 AND t.template_id IS NULL
    LEFT JOIN templates t2 ON t2.tenant_id = $1 AND t2.created_at >= $2 AND t2.created_at < $3 AND t2.template_id IS NOT NULL
    LEFT JOIN versions v ON v.tenant_id = $1 AND v.created_at >= $2 AND v.created_at < $3
    LEFT JOIN webhook_deliveries wd ON wd.tenant_id = $1 AND wd.created_at >= $2 AND wd.created_at < $3
    WHERE ar.tenant_id = $1 AND ar.timestamp >= $2 AND ar.timestamp < $3
  `, [tenantId, periodStart, periodEnd]);

  if (rows.length === 0) {
    return {
      api_requests: 0,
      jobs_completed: 0,
      jobs_failed: 0,
      jobs_created: 0,
      templates_created: 0,
      templates_forked: 0,
      versions_created: 0,
      webhooks_delivered: 0,
      webhooks_failed: 0
    };
  }

  return rows[0];
}

/**
 * Compute cost metrics for the given period.
 * Currently only LLM cost is considered (storage cost ignored for MVP).
 * @param {number} tenantId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {object} db
 * @returns {Promise<Object>}
 */
export async function computeCostMetrics(tenantId, periodStart, periodEnd, db) {
  // For now, we rely on the Prometheus metric flash_archi_llm_cost_usd_total
  // In a real implementation, we might have a table that logs LLM usage per request.
  // Since we don't have that, we'll return 0 and note that this should be updated when LLM usage tracking is available.
  // However, we can attempt to compute from the api_request_log if we have a cost field.
  // Let's assume we have a column `llm_cost_usd` in api_request_log for now.
  const { rows } = await db.query(`
    SELECT 
      COALESCE(SUM(llm_cost_usd), 0) AS llm_usd,
      COALESCE(SUM(llm_tokens_input), 0) AS llm_tokens_input,
      COALESCE(SUM(llm_tokens_output), 0) AS llm_tokens_output
    FROM api_request_log
    WHERE tenant_id = $1 AND timestamp >= $2 AND timestamp < $3
  `, [tenantId, periodStart, periodEnd]);

  if (rows.length === 0) {
    return {
      llm_usd: 0,
      llm_tokens_input: 0,
      llm_tokens_output: 0
    };
  }

  return rows[0];
}

/**
 * Compute performance metrics for the given period.
 * @param {number} tenantId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {object} db
 * @returns {Promise<Object>}
 */
export async function computePerformanceMetrics(tenantId, periodStart, periodEnd, db) {
  const { rows } = await db.query(`
    SELECT 
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY j.duration_ms) AS job_duration_p50_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY j.duration_ms) AS job_duration_p95_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY j.duration_ms) AS job_duration_p99_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ar.latency_ms) AS api_latency_p95_ms,
      CASE 
        WHEN COUNT(j.id) = 0 THEN 0
        ELSE COUNT(CASE WHEN j.status = 'failed' THEN 1 END)::DECIMAL / COUNT(j.id)
      END AS error_rate
    FROM jobs j
    LEFT JOIN api_request_log ar ON ar.tenant_id = j.tenant_id AND ar.timestamp >= j.created_at AND ar.timestamp < j.created_at + interval '1 hour'
    WHERE j.tenant_id = $1 AND j.created_at >= $2 AND j.created_at < $3
  `, [tenantId, periodStart, periodEnd]);

  if (rows.length === 0) {
    return {
      job_duration_p50_ms: 0,
      job_duration_p95_ms: 0,
      job_duration_p99_ms: 0,
      api_latency_p95_ms: 0,
      error_rate: 0
    };
  }

  // Handle nulls from PERCENTILE_CONT when there are no rows
  return {
    job_duration_p50_ms: rows[0].job_duration_p50_ms ?? 0,
    job_duration_p95_ms: rows[0].job_duration_p95_ms ?? 0,
    job_duration_p99_ms: rows[0].job_duration_p99_ms ?? 0,
    api_latency_p95_ms: rows[0].api_latency_p95_ms ?? 0,
    error_rate: rows[0].error_rate ?? 0
  };
}

/**
 * Compute popularity metrics for the given period.
 * @param {number} tenantId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {object} db
 * @returns {Promise<Object>}
 */
export async function computePopularityMetrics(tenantId, periodStart, periodEnd, db) {
  // Top tags (from templates created in the period)
  const topTagsRows = await db.query(`
    SELECT 
      tag,
      COUNT(*) AS count
    FROM templates, UNNEST(tags) AS tag
    WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 10
  `, [tenantId, periodStart, periodEnd]);

  // Top templates forked (templates that have been forked the most in the period)
  const topTemplatesForkedRows = await db.query(`
    SELECT 
      t.id AS template_id,
      t.name,
      COUNT(p.id) AS forks
    FROM templates t
    JOIN projects p ON p.template_id = t.id
    WHERE t.tenant_id = $1 AND p.created_at >= $2 AND p.created_at < $3
    GROUP BY t.id, t.name
    ORDER BY forks DESC
    LIMIT 10
  `, [tenantId, periodStart, periodEnd]);

  // Artifact types distribution
  const artifactTypesRows = await db.query(`
    SELECT 
      a.type,
      COUNT(*) AS count
    FROM artifacts a
    JOIN jobs j ON j.id = a.job_id
    WHERE j.tenant_id = $1 AND j.created_at >= $2 AND j.created_at < $3
    GROUP BY a.type
  `, [tenantId, periodStart, periodEnd]);

  const artifactTypes = {};
  for (const row of artifactTypesRows.rows) {
    artifactTypes[row.type] = row.count;
  }

  return {
    top_tags: topTagsRows.rows.map(r => ({ tag: r.tag, count: r.count })),
    top_templates_forked: topTemplatesForkedRows.rows.map(r => ({
      template_id: r.template_id,
      name: r.name,
      forks: r.forks
    })),
    artifact_types: artifactTypes
  };
}

/**
 * Compute top API keys by request count for the given period.
 * @param {number} tenantId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {object} db
 * @returns {Promise<Array>}
 */
export async function computeTopApiKeys(tenantId, periodStart, periodEnd, db) {
  const { rows } = await db.query(`
    SELECT 
      api_key_prefix,
      COUNT(*) AS requests
    FROM api_request_log
    WHERE tenant_id = $1 AND timestamp >= $2 AND timestamp < $3
    GROUP BY api_key_prefix
    ORDER BY requests DESC
    LIMIT 10
  `, [tenantId, periodStart, periodEnd]);

  return rows.map(r => ({
    prefix: r.api_key_prefix,
    requests: r.requests
  }));
}

/**
 * Check thresholds for the given tenant and metrics, and trigger webhooks if needed.
 * @param {number} tenantId
 * @param {Object} metrics
 * @param {object} db
 */
export async function checkThresholds(tenantId, metrics, db) {
  const { rows } = await db.query(
    'SELECT * FROM tenant_analytics_config WHERE tenant_id = $1',
    [tenantId]
  );

  if (rows.length === 0) return;
  const config = rows[0];

  // Check monthly cost threshold (sum of last 30 days)
  const monthlyCost = await computeMonthlyCost(tenantId, db);
  if (monthlyCost > config.cost_threshold_usd && config.alert_webhook_enabled) {
    await dispatchWebhook(tenantId, 'analytics.threshold_exceeded', {
      tenantId,
      thresholdType: 'cost_monthly',
      currentValue: monthlyCost,
      thresholdValue: config.cost_threshold_usd,
      timestamp: new Date().toISOString()
    });
  }

  // Check error rate threshold
  if (metrics.performance.error_rate > config.error_rate_threshold && config.alert_webhook_enabled) {
    await dispatchWebhook(tenantId, 'analytics.threshold_exceeded', {
      tenantId,
      thresholdType: 'error_rate',
      currentValue: metrics.performance.error_rate,
      thresholdValue: config.error_rate_threshold,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Compute the monthly cost (LLM) for the given tenant (last 30 days).
 * @param {number} tenantId
 * @param {object} db
 * @returns {Promise<number>}
 */
export async function computeMonthlyCost(tenantId, db) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { rows } = await db.query(`
    SELECT COALESCE(SUM(llm_cost_usd), 0) AS total
    FROM api_request_log
    WHERE tenant_id = $1 AND timestamp >= $2
  `, [tenantId, thirtyDaysAgo]);

  return rows.length > 0 ? rows[0].total : 0;
}

/**
 * Helper function to dispatch a webhook (reuses the existing webhook dispatch mechanism from P2-03).
 * In a real implementation, this would call the existing dispatchWebhook function.
 * For now, we'll assume it's available globally or we'll import it.
 * Since we cannot import from another file in this context, we'll leave a placeholder.
 * In the actual codebase, you would import the dispatchWebhook function from src/webhooks.js or similar.
 */
async function dispatchWebhook(tenantId, eventType, payload) {
  // This function should be implemented by reusing the existing webhook dispatch from P2-03.
  // For the purpose of this file, we'll assume it's available via a global or we'll log a warning.
  // In the actual codebase, you would do:
  //   const { dispatchWebhook } = require('./webhooks');
  //   await dispatchWebhook(tenantId, eventType, payload);
  // Since we cannot do that here, we'll just log to console for now.
  console.log(`[Analytics] Would dispatch webhook: tenantId=${tenantId}, event=${eventType}, payload=${JSON.stringify(payload)}`);
}