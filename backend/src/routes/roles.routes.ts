import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { Role } from '../types';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<Role>('SELECT id, name, description FROM roles ORDER BY name ASC');
    res.json({ roles: rows });
  })
);
