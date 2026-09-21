import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

// Miroir de Settings.tsx (onglet portail patient) — approve_portal_account /
// reject_portal_account sont des RPC SECURITY DEFINER qui créent/rejettent le
// compte ET la fiche patient liée en une transaction atomique.
export const patientPortalRouter = Router();
patientPortalRouter.use(requireAuth);

patientPortalRouter.post('/approve', asyncHandler(async (req, res) => {
  const { portalAccountId, existingPatientId } = req.body as { portalAccountId: string; existingPatientId?: string | null };
  const result = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT approve_portal_account($1, $2) AS result', [portalAccountId, existingPatientId ?? null])
      .then((r) => r.rows[0].result),
  );
  res.json(result);
}));

patientPortalRouter.post('/reject', asyncHandler(async (req, res) => {
  const { portalAccountId, reason } = req.body as { portalAccountId: string; reason?: string | null };
  const result = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT reject_portal_account($1, $2) AS result', [portalAccountId, reason ?? null])
      .then((r) => r.rows[0].result),
  );
  res.json(result);
}));
