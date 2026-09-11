import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { getEffectiveLevel } from '../middleware/pageAccess';
import { performSearch } from '../services/searchService';

export const searchRouter = Router();
searchRouter.use(requireAuth);

const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(200) });

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q } = searchQuerySchema.parse(req.query);
    const documentsAccessLevel = await getEffectiveLevel(req.user!.roles, req.user!.roleIds, 'DOCUMENTS');
    const results = await performSearch(pool, { query: q, user: req.user!, documentsAccessLevel });
    res.json(results);
  })
);
