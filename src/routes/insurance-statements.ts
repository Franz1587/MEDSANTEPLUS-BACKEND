import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const insuranceStatementsRouter = Router();
insuranceStatementsRouter.use(requireAuth);

// Miroir de src/lib/db/insurance-statements.ts — mapRow() (snake_case → camelCase)
// reproduit ici puisqu'il n'existe pas de couche de mapping partagée côté backend.
function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id, ref: r.ref, structureId: r.structure_id,
    insuranceId: r.insurance_id ?? undefined,
    insuranceName: r.insurance_name,
    subscriberCompanyId: r.subscriber_company_id ?? undefined,
    souscripteur: r.souscripteur,
    periodStart: r.period_start, periodEnd: r.period_end,
    prestationIds: r.prestation_ids ?? [],
    totalBrut: Number(r.total_brut),
    totalTiersPayant: Number(r.total_tiers_payant),
    totalPatient: Number(r.total_patient),
    status: r.status,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
  };
}

insuranceStatementsRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM insurance_statements WHERE structure_id = $1 ORDER BY created_at DESC', [structureId])
      .then((r) => r.rows),
  );
  res.json(rows.map(mapRow));
}));

insuranceStatementsRouter.post('/', asyncHandler(async (req, res) => {
  const s = req.body as Record<string, unknown>;
  const row = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO insurance_statements
        (structure_id, ref, insurance_id, insurance_name, subscriber_company_id, souscripteur,
         period_start, period_end, prestation_ids, total_brut, total_tiers_payant, total_patient,
         status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [s.structureId, s.ref, s.insuranceId ?? null, s.insuranceName, s.subscriberCompanyId ?? null,
       s.souscripteur, s.periodStart, s.periodEnd, s.prestationIds, s.totalBrut, s.totalTiersPayant,
       s.totalPatient, s.status, s.createdBy ?? null],
    );
    return rows[0];
  });
  res.status(201).json(mapRow(row));
}));

insuranceStatementsRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body as { status: string };
  await withUserContext(req.authUser!, (client) =>
    client.query('UPDATE insurance_statements SET status = $1 WHERE id = $2', [status, req.params.id]),
  );
  res.status(204).end();
}));

insuranceStatementsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query('DELETE FROM insurance_statements WHERE id = $1', [req.params.id]),
  );
  res.status(204).end();
}));
