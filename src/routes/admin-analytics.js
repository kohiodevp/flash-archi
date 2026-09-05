// src/routes/admin-analytics.js
import express from 'express';
import { authenticate, requireScope } from '../middleware/auth.js';
import { dbMiddleware, dbRelease } from '../middleware/db.js';

const router = express.Router();

router.use(dbMiddleware);

// GET /api/public/v1/admin/analytics/global
router.get('/global',
  authenticate,
  requireScope('admin:analytics'),
  async (req, res) => {
    // Placeholder: we would compute global aggregates across all tenants
    // For now, return empty structure
    res.json({
      totalTenants: 0,
      totalApiRequests: 0,
      totalJobsCreated: 0,
      totalLlmCostUsd: 0,
      // ... other global metrics
    });
  }
);

// GET /api/public/v1/admin/analytics/tenants/:tenantId
router.get('/tenants/:tenantId',
  authenticate,
  requireScope('admin:analytics'),
  async (req, res) => {
    const { tenantId } = req.params;
    // We could reuse the tenant overview endpoint but ensure the requester has admin scope
    // For simplicity, we'll call the same logic as tenant overview but we need to check that the tenant exists.
    // We'll just return a placeholder.
    res.json({
      tenantId: parseInt(tenantId),
      // ... tenant-specific analytics
    });
  }
);

router.use(dbRelease);

export default router;