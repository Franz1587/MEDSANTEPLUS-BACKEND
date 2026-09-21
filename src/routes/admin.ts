import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

/**
 * Passerelles vers les RPC SECURITY DEFINER utilisées par SuperAdmin.tsx —
 * bypass RLS complet, bien plus rapide que des requêtes directes qui
 * appellent is_platform_admin() ligne par ligne. La fonction elle-même
 * vérifie déjà les droits (super_admin/support_admin) ; withUserContext ne
 * fait ici que porter l'identité de l'appelant pour que auth.uid() résolve
 * correctement à l'intérieur de la fonction.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get('/superadmin-profile', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM get_superadmin_profile()').then((r) => r.rows),
  );
  res.json(rows);
}));

adminRouter.get('/structures', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM get_structures_admin()').then((r) => r.rows),
  );
  res.json(rows);
}));

adminRouter.get('/staff', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM get_all_staff_admin()').then((r) => r.rows),
  );
  res.json(rows);
}));

adminRouter.get('/clinic-profiles', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM get_clinic_profiles()').then((r) => r.rows),
  );
  res.json(rows);
}));
