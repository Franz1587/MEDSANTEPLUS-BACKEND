import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert } from '../util.js';
import { simpleCrudRouter } from '../crud.js';

// Miroir des accès Administration.tsx : gardes (guard_shifts), avantages
// personnel (staff_benefit_accounts/transactions), droits supplémentaires
// (profiles.extra_rights via la RPC update_extra_rights).
export const hrRouter = Router();
hrRouter.use(requireAuth);

// -- Gardes -------------------------------------------------------------

hrRouter.get('/guard-shifts', asyncHandler(async (req, res) => {
  const { structureId, limit } = req.query as { structureId?: string; limit?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM guard_shifts WHERE structure_id = $1 ORDER BY started_at DESC LIMIT $2', [structureId, Number(limit) || 100])
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

// -- Contrats, congés, carrière, paie (HumanResources.tsx) ----------------
// Pattern list-by-structure / create / update par id identique dans les
// quatre cas — simpleCrudRouter couvre déjà exactement ce besoin.

hrRouter.use('/contracts', simpleCrudRouter({
  table: 'hr_contracts',
  columns: ['structure_id', 'staff_id', 'contract_type', 'start_date', 'end_date', 'renewal_date', 'salary_base', 'salary_currency', 'weekly_hours', 'position', 'department', 'trial_end_date', 'notes', 'is_active'],
  orderBy: 'created_at DESC',
}));

hrRouter.use('/leaves', simpleCrudRouter({
  table: 'hr_leaves',
  columns: ['structure_id', 'staff_id', 'leave_type', 'start_date', 'end_date', 'days_count', 'reason', 'status', 'approved_by', 'approved_at', 'rejection_note'],
  orderBy: 'created_at DESC',
}));

hrRouter.use('/career-events', simpleCrudRouter({
  table: 'hr_career_events',
  columns: ['structure_id', 'staff_id', 'event_type', 'event_date', 'previous_value', 'new_value', 'description', 'created_by'],
  orderBy: 'event_date DESC',
}));

hrRouter.use('/payroll', simpleCrudRouter({
  table: 'hr_payroll',
  columns: ['structure_id', 'staff_id', 'period_year', 'period_month', 'salary_base', 'salary_currency', 'allowances', 'deductions', 'bonus', 'garde_amount', 'honoraire_amount', 'net_salary', 'status', 'payment_date', 'notes'],
  orderBy: 'period_year DESC',
}));

// -- Évaluations, pointage, planning — upsert sur contrainte composite ----

hrRouter.get('/evaluations', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM hr_evaluations WHERE structure_id = $1 ORDER BY period_year DESC', [structureId]).then((r) => r.rows),
  );
  res.json(rows);
}));

const EVAL_COLUMNS = [
  'structure_id', 'staff_id', 'period_year', 'evaluator_id', 'score_global', 'score_ponctualite',
  'score_competence', 'score_travail_equipe', 'score_initiative', 'appreciations', 'axes_amelioration',
  'objectifs_suivants', 'status',
] as const;

hrRouter.post('/evaluations/upsert', asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const row = await withUserContext(req.authUser!, async (client) => {
    const cols = EVAL_COLUMNS.filter((c) => body[c] !== undefined);
    const values = cols.map((c) => body[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => !['structure_id', 'staff_id', 'period_year'].includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
    const { rows } = await client.query(
      `INSERT INTO hr_evaluations (${cols.join(',')}) VALUES (${placeholders.join(',')})
       ON CONFLICT (structure_id, staff_id, period_year) DO UPDATE SET ${updates.join(',')}, updated_at = now()
       RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.json(row);
}));

hrRouter.get('/pointage', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM hr_pointage WHERE structure_id = $1 ORDER BY date DESC LIMIT 200', [structureId]).then((r) => r.rows),
  );
  res.json(rows);
}));

const POINTAGE_COLUMNS = ['structure_id', 'staff_id', 'date', 'arrival_time', 'departure_time', 'break_duration', 'status', 'notes'] as const;

hrRouter.post('/pointage/upsert', asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const row = await withUserContext(req.authUser!, async (client) => {
    const cols = POINTAGE_COLUMNS.filter((c) => body[c] !== undefined);
    const values = cols.map((c) => body[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => !['structure_id', 'staff_id', 'date'].includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
    const { rows } = await client.query(
      `INSERT INTO hr_pointage (${cols.join(',')}) VALUES (${placeholders.join(',')})
       ON CONFLICT (structure_id, staff_id, date) DO UPDATE SET ${updates.join(',')}
       RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.json(row);
}));

hrRouter.get('/planning', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM hr_planning WHERE structure_id = $1 ORDER BY week_start DESC LIMIT 100', [structureId]).then((r) => r.rows),
  );
  res.json(rows);
}));

hrRouter.patch('/planning/:id', asyncHandler(async (req, res) => {
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const [day] = Object.keys(req.body).filter((k) => DAYS.includes(k));
  if (!day) { res.status(400).json({ error: 'Aucun jour valide fourni' }); return; }
  await withUserContext(req.authUser!, (client) =>
    client.query(`UPDATE hr_planning SET ${day} = $1 WHERE id = $2`, [req.body[day], req.params.id]),
  );
  res.status(204).end();
}));

hrRouter.post('/planning', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('hr_planning', ['structure_id', 'staff_id', 'week_start', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

hrRouter.post('/planning/bulk-upsert', asyncHandler(async (req, res) => {
  const entries = req.body as Record<string, unknown>[];
  if (!Array.isArray(entries) || entries.length === 0) { res.json([]); return; }
  const cols = ['structure_id', 'staff_id', 'week_start', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const rows = await withUserContext(req.authUser!, async (client) => {
    const created: unknown[] = [];
    for (const entry of entries) {
      const present = cols.filter((c) => entry[c] !== undefined);
      const values = present.map((c) => entry[c]);
      const placeholders = present.map((_, i) => `$${i + 1}`);
      const updates = present.filter((c) => !['structure_id', 'staff_id', 'week_start'].includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
      const { rows: r } = await client.query(
        `INSERT INTO hr_planning (${present.join(',')}) VALUES (${placeholders.join(',')})
         ON CONFLICT (structure_id, staff_id, week_start) DO UPDATE SET ${updates.join(',')}
         RETURNING *`,
        values,
      );
      created.push(r[0]);
    }
    return created;
  });
  res.status(201).json(rows);
}));

// -- Fiches d'honoraires médecin (doctor_honoraire_slips) — Accounting.tsx ----

hrRouter.get('/honoraire-slips', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT id FROM doctor_honoraire_slips WHERE structure_id = $1', [structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

const HONORAIRE_SLIP_COLUMNS = [
  'id', 'structure_id', 'staff_id', 'doctor_name', 'period', 'slip_ref',
  'honoraires_bruts', 'gardes_amount', 'total_amount', 'items', 'garde_items', 'status',
] as const;

hrRouter.post('/honoraire-slips/upsert', asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const present = HONORAIRE_SLIP_COLUMNS.filter((c) => body[c] !== undefined);
  const values = present.map((c) => (c === 'items' || c === 'garde_items') && typeof body[c] !== 'string' ? JSON.stringify(body[c]) : body[c]);
  const placeholders = present.map((_, i) => `$${i + 1}`);
  const updates = present.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`);
  const row = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO doctor_honoraire_slips (${present.join(',')}) VALUES (${placeholders.join(',')})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(',')}
       RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.status(201).json(row);
}));
