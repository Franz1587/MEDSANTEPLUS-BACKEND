import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert } from '../util.js';

export const hospActsRouter = Router();
hospActsRouter.use(requireAuth);

const HOSP_ACT_COLUMNS = [
  'structure_id', 'hospitalization_id', 'patient_id', 'act_date', 'category', 'code',
  'description', 'quantity', 'unit_price', 'lettre_key', 'status', 'created_by',
] as const;

// Miroir de fetchHospActs()
hospActsRouter.get('/by-hospitalization/:hospitalizationId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      'SELECT * FROM hospitalization_acts WHERE hospitalization_id = $1 ORDER BY act_date ASC, created_at ASC',
      [req.params.hospitalizationId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// Miroir de createHospActs() — insertion multiple en une seule requête
hospActsRouter.post('/bulk', asyncHandler(async (req, res) => {
  const acts = req.body as Record<string, unknown>[];
  if (!Array.isArray(acts) || acts.length === 0) { res.json([]); return; }
  const rows = await withUserContext(req.authUser!, async (client) => {
    const created: unknown[] = [];
    for (const act of acts) {
      const insert = buildInsert('hospitalization_acts', HOSP_ACT_COLUMNS, act);
      const { rows: r } = await client.query(insert.text, insert.values);
      created.push(r[0]);
    }
    return created;
  });
  res.status(201).json(rows);
}));

// Miroir de cancelHospAct()
hospActsRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query("UPDATE hospitalization_acts SET status = 'cancelled', updated_at = now() WHERE id = $1", [req.params.id]),
  );
  res.status(204).end();
}));
