import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const devisRouter = Router();
devisRouter.use(requireAuth);

// Miroir de src/lib/db/devis.ts
const DEVIS_COLUMNS = [
  'structure_id', 'reference', 'patient_id', 'patient_name', 'patient_phone', 'patient_dob',
  'insurance_id', 'insurance_name', 'type', 'items', 'subtotal', 'discount', 'total', 'status',
  'valid_until', 'notes', 'created_by_id', 'created_by_name', 'created_by_role',
] as const;

// generateDevisReference() — compte les devis DEV-YYYYMM-% du mois pour la structure.
devisRouter.get('/generate-reference', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `DEV-${ym}-`;
  const reference = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      "SELECT count(*) AS c FROM devis WHERE structure_id = $1 AND reference LIKE $2",
      [structureId, `${prefix}%`],
    );
    const seq = String(Number(rows[0].c) + 1).padStart(4, '0');
    return `${prefix}${seq}`;
  });
  res.json({ reference });
}));

devisRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId, limit } = req.query as { structureId?: string; limit?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM devis WHERE structure_id = $1 ORDER BY created_at DESC LIMIT $2', [structureId, Number(limit) || 300])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

devisRouter.get('/by-patient/:patientId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM devis WHERE patient_id = $1 ORDER BY created_at DESC', [req.params.patientId]).then((r) => r.rows),
  );
  res.json(rows);
}));

devisRouter.get('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM devis WHERE id = $1', [req.params.id]).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

devisRouter.post('/', asyncHandler(async (req, res) => {
  const body = { ...req.body, items: typeof req.body.items === 'string' ? req.body.items : JSON.stringify(req.body.items) };
  const cols = DEVIS_COLUMNS.filter((c) => body[c] !== undefined);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map((c) => body[c]);
  const row = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO devis (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.status(201).json(row);
}));

// Miroir de updateDevis() : les champs created_by_*/created_at/structure_id/reference
// ne sont jamais acceptés en update, même si transmis (déjà bloqués par un trigger DB).
const DEVIS_UPDATABLE = DEVIS_COLUMNS.filter(
  (c) => !['structure_id', 'reference', 'created_by_id', 'created_by_name', 'created_by_role'].includes(c),
);
devisRouter.patch('/:id', asyncHandler(async (req, res) => {
  const body = {
    ...req.body,
    items: req.body.items !== undefined && typeof req.body.items !== 'string' ? JSON.stringify(req.body.items) : req.body.items,
    updated_at: new Date().toISOString(),
  };
  const cols = [...DEVIS_UPDATABLE, 'updated_by_id', 'updated_by_name', 'updated_at'].filter((c) => body[c] !== undefined);
  if (cols.length === 0) { res.status(400).json({ error: 'Aucun champ à mettre à jour' }); return; }
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const values = cols.map((c) => body[c]);
  values.push(req.params.id);
  const row = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(`UPDATE devis SET ${sets.join(',')} WHERE id = $${values.length} RETURNING *`, values);
    return rows[0];
  });
  res.json(row);
}));

devisRouter.delete('/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) => client.query('DELETE FROM devis WHERE id = $1', [req.params.id]));
  res.status(204).end();
}));
