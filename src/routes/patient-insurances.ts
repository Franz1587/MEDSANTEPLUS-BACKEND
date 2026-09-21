import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const patientInsurancesRouter = Router();
patientInsurancesRouter.use(requireAuth);

// Miroir de src/lib/db/patient-insurances.ts
const LINK_COLUMNS = [
  'id', 'structure_id', 'patient_id', 'insurance_company_id', 'insurance_name',
  'subscriber_company_id', 'subscriber_company_name', 'role', 'relationship',
  'main_subscriber_patient_id', 'main_subscriber_first_name', 'main_subscriber_last_name',
  'main_subscriber_nag', 'main_subscriber_policy_number', 'main_subscriber_employer',
  'policy_number', 'nag', 'coverage_rate', 'is_cnamgs', 'cnamgs_type', 'affection_type',
  'valid_until', 'is_active',
] as const;

patientInsurancesRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM patient_insurance_links WHERE structure_id = $1', [structureId]).then((r) => r.rows),
  );
  res.json(rows);
}));

patientInsurancesRouter.post('/', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('patient_insurance_links', LINK_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

// Miroir exact : update/delete exigent structure_id ET id (double condition
// dans la requête d'origine, conservée ici même si RLS l'imposerait déjà).
patientInsurancesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('patient_insurance_links', LINK_COLUMNS, req.body, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const text = update.text.replace('RETURNING *', 'AND structure_id = $' + (update.values.length + 1) + ' RETURNING *');
    const { rows } = await client.query(text, [...update.values, structureId]);
    return rows[0];
  });
  res.json(row);
}));

patientInsurancesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  await withUserContext(req.authUser!, (client) =>
    client.query('DELETE FROM patient_insurance_links WHERE id = $1 AND structure_id = $2', [req.params.id, structureId]),
  );
  res.status(204).end();
}));
