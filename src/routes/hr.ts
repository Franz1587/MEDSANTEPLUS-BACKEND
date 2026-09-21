import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert } from '../util.js';

// Miroir des accès Administration.tsx : gardes (guard_shifts), avantages
// personnel (staff_benefit_accounts/transactions), droits supplémentaires
// (profiles.extra_rights via la RPC update_extra_rights).
export const hrRouter = Router();
hrRouter.use(requireAuth);

// -- Gardes -------------------------------------------------------------

hrRouter.get('/guard-shifts', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM guard_shifts WHERE structure_id = $1 ORDER BY started_at DESC LIMIT 100', [structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

const GUARD_COLUMNS = ['structure_id', 'staff_id', 'staff_name', 'staff_role', 'notes'] as const;

hrRouter.post('/guard-shifts', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('guard_shifts', GUARD_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

hrRouter.patch('/guard-shifts/:id/end', asyncHandler(async (req, res) => {
  const { endedAt, durationMinutes } = req.body as { endedAt: string; durationMinutes: number };
  await withUserContext(req.authUser!, (client) =>
    client.query('UPDATE guard_shifts SET ended_at = $1, duration_minutes = $2 WHERE id = $3', [endedAt, durationMinutes, req.params.id]),
  );
  res.status(204).end();
}));

// -- Avantages personnel (réductions soins, avances sur salaire) --------

hrRouter.get('/benefit-account', asyncHandler(async (req, res) => {
  const { staffId, structureId } = req.query as { staffId?: string; structureId?: string };
  if (!staffId || !structureId) { res.status(400).json({ error: 'staffId et structureId requis' }); return; }
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT discount_rate FROM staff_benefit_accounts WHERE staff_id = $1 AND structure_id = $2 LIMIT 1', [staffId, structureId])
      .then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

hrRouter.post('/benefit-account/upsert', asyncHandler(async (req, res) => {
  const { staffId, structureId, discountRate } = req.body as { staffId: string; structureId: string; discountRate: number };
  await withUserContext(req.authUser!, (client) =>
    client.query(
      `INSERT INTO staff_benefit_accounts (staff_id, structure_id, discount_rate, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (staff_id, structure_id) DO UPDATE SET discount_rate = EXCLUDED.discount_rate, updated_at = now()`,
      [staffId, structureId, discountRate],
    ),
  );
  res.status(204).end();
}));

hrRouter.get('/benefit-transactions', asyncHandler(async (req, res) => {
  const { staffId, structureId } = req.query as { staffId?: string; structureId?: string };
  if (!staffId || !structureId) { res.status(400).json({ error: 'staffId et structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM staff_benefit_transactions WHERE staff_id = $1 AND structure_id = $2 ORDER BY date DESC', [staffId, structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

const TX_COLUMNS = [
  'staff_id', 'structure_id', 'type', 'beneficiary', 'beneficiary_name',
  'description', 'gross_amount', 'discount_pct', 'amount_due', 'date', 'notes',
] as const;

hrRouter.post('/benefit-transactions', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('staff_benefit_transactions', TX_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

hrRouter.delete('/benefit-transactions/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query('DELETE FROM staff_benefit_transactions WHERE id = $1', [req.params.id]),
  );
  res.status(204).end();
}));

// -- Droits supplémentaires (profiles.extra_rights) ----------------------

hrRouter.get('/extra-rights/:staffId', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT extra_rights FROM profiles WHERE staff_id = $1 LIMIT 1', [req.params.staffId])
      .then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

hrRouter.post('/extra-rights', asyncHandler(async (req, res) => {
  const { staffId, rights } = req.body as { staffId: string; rights: string[] };
  await withUserContext(req.authUser!, (client) =>
    client.query('SELECT update_extra_rights($1, $2)', [staffId, rights]),
  );
  res.status(204).end();
}));
