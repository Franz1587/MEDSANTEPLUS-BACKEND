import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert } from '../util.js';

export const vitalsRouter = Router();
vitalsRouter.use(requireAuth);

// Miroir de src/lib/db/vitals.ts — le mapping snake_case → camelCase
// (mapVitalRow) reste côté frontend, inchangé ; le backend renvoie la ligne
// brute comme le faisait déjà Supabase.
const VITAL_COLUMNS = [
  'id', 'structure_id', 'patient_id', 'hospitalization_id', 'recorded_at', 'recorded_by',
  'session', 'systolic_bp', 'diastolic_bp', 'heart_rate', 'temperature',
  'oxygen_saturation', 'respiratory_rate', 'weight', 'height', 'pain_score',
] as const;

vitalsRouter.get('/by-patient/:patientId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM vital_records WHERE patient_id = $1 ORDER BY recorded_at DESC', [req.params.patientId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

vitalsRouter.get('/by-hospitalization/:hospitalizationId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM vital_records WHERE hospitalization_id = $1 ORDER BY recorded_at DESC', [req.params.hospitalizationId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

vitalsRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM vital_records WHERE structure_id = $1 ORDER BY recorded_at DESC', [structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

vitalsRouter.post('/', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('vital_records', VITAL_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
