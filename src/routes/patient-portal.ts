import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

// Miroir de Settings.tsx (onglet portail patient) — approve_portal_account /
// reject_portal_account sont des RPC SECURITY DEFINER qui créent/rejettent le
// compte ET la fiche patient liée en une transaction atomique.
export const patientPortalRouter = Router();
patientPortalRouter.use(requireAuth);

// GET /patient-portal/pending?structureId=... — demandes d'inscription en attente (Settings.tsx)
patientPortalRouter.get('/pending', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT id,first_name,last_name,email,phone,has_insurance,insurance_id,insurance_policy_number,
              is_cnamgs,cnamgs_type,nag_cnamgs,status,created_at
       FROM patient_portal_accounts WHERE structure_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// GET /patient-portal/matching-patients?structureId=&email=&phone= — fiches patient
// correspondant à une demande d'inscription portail (par email ou téléphone).
patientPortalRouter.get('/matching-patients', asyncHandler(async (req, res) => {
  const { structureId, email, phone } = req.query as { structureId?: string; email?: string; phone?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT id,first_name,last_name,phone,email,date_of_birth FROM patients
       WHERE structure_id = $1 AND (email = $2 OR phone = $3)`,
      [structureId, email ?? '', phone ?? ''],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

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
