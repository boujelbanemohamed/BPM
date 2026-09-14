import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { getDashboardSummary } from '../services/dashboardService';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await getDashboardSummary(pool, req.user!);
    res.json(summary);
  })
);
