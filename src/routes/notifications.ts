import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

/**
 * Compteurs de badges affichés dans Layout.tsx (demandes de rendez-vous et
 * comptes portail en attente) — c'était un appel supabase.from(...).select(
 * 'id', {count:'exact', head:true}) direct, hors couche src/lib/db/*.
 */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/pending-bookings-count', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const count = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      "SELECT count(*)::int AS c FROM booking_requests WHERE structure_id = $1 AND status = 'pending'",
      [structureId],
    );
    return rows[0].c;
  });
  res.json({ count });
}));

notificationsRouter.get('/pending-portal-requests-count', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const count = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      "SELECT count(*)::int AS c FROM patient_portal_accounts WHERE structure_id = $1 AND status = 'pending'",
      [structureId],
    );
    return rows[0].c;
  });
  res.json({ count });
}));
