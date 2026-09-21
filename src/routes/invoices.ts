import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

/** Colonnes autorisées en écriture — miroir de InvoiceInsert dans
 *  src/lib/database.types.ts côté frontend. */
const INVOICE_COLUMNS = [
  'id', 'structure_id', 'patient_id', 'date', 'items', 'subtotal', 'tax', 'total',
  'status', 'insurance_id', 'insurance_part', 'patient_part', 'tiers_payant',
  'payment_method', 'notes', 'consultation_id', 'hospitalization_id',
  'discount_amount', 'discount_reason', 'cancelled_at', 'cancelled_by',
  'cancellation_reason', 'created_at',
] as const;

/** `items` est stocké en jsonb — le driver pg attend une chaîne pour ce
 *  type de colonne, jamais un objet/tableau JS brut. */
function normalizeJsonColumns(body: Record<string, unknown>) {
  if (body.items !== undefined && typeof body.items !== 'string') {
    return { ...body, items: JSON.stringify(body.items) };
  }
  return body;
}

// GET /api/invoices?structureId=...&limit=200 — miroir de fetchInvoices()
invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { structureId, limit } = req.query as { structureId?: string; limit?: string };
    if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        `SELECT id,patient_id,date,items,subtotal,tax,total,status,insurance_id,insurance_part,
                patient_part,tiers_payant,discount_amount,notes,hospitalization_id
         FROM invoices WHERE structure_id = $1 ORDER BY date DESC LIMIT $2`,
        [structureId, Number(limit) || 200],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// GET /api/invoices/by-status?structureId=&statuses=pending,draft&limit=300&from=&to= — miroir des
// filtres .in('status', [...]) utilisés par Billing.tsx et Caisse.tsx (file d'attente, clôturées,
// relevés, encaissements du jour, historique) — from/to filtrent sur created_at (optionnels).
invoicesRouter.get(
  '/by-status',
  asyncHandler(async (req, res) => {
    const { structureId, statuses, limit, from, to } = req.query as {
      structureId?: string; statuses?: string; limit?: string; from?: string; to?: string;
    };
    if (!structureId || !statuses) { res.status(400).json({ error: 'structureId et statuses requis' }); return; }
    const statusList = statuses.split(',').filter(Boolean);
    const rows = await withUserContext(req.authUser!, (client) => {
      const values: unknown[] = [structureId, statusList];
      let where = 'structure_id = $1 AND status = ANY($2)';
      if (from) { values.push(from); where += ` AND created_at >= $${values.length}`; }
      if (to)   { values.push(to);   where += ` AND created_at <= $${values.length}`; }
      values.push(Number(limit) || 300);
      return client.query(
        `SELECT id,patient_id,date,items,subtotal,tax,total,status,insurance_id,insurance_part,
                patient_part,tiers_payant,payment_method,created_at
         FROM invoices WHERE ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      ).then((r) => r.rows);
    });
    res.json(rows);
  }),
);

// GET /api/invoices/by-patient/:patientId — miroir de fetchInvoicesByPatient()
invoicesRouter.get(
  '/by-patient/:patientId',
  asyncHandler(async (req, res) => {
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query('SELECT * FROM invoices WHERE patient_id = $1 ORDER BY date DESC', [req.params.patientId])
        .then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// GET /api/invoices/by-hospitalization/:hospitalizationId — miroir de Hospitalizations.tsx
invoicesRouter.get(
  '/by-hospitalization/:hospitalizationId',
  asyncHandler(async (req, res) => {
    const { structureId } = req.query as { structureId?: string };
    const row = await withUserContext(req.authUser!, (client) => {
      const values: unknown[] = [req.params.hospitalizationId];
      let where = 'hospitalization_id = $1';
      if (structureId) { values.push(structureId); where += ` AND structure_id = $${values.length}`; }
      return client.query(`SELECT id FROM invoices WHERE ${where} LIMIT 1`, values).then((r) => r.rows[0] ?? null);
    });
    res.json(row);
  }),
);

// GET /api/invoices/:id — miroir de handleOpenEditInvoice (Billing.tsx)
invoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await withUserContext(req.authUser!, (client) =>
      client.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]).then((r) => r.rows[0] ?? null),
    );
    res.json(row);
  }),
);

// POST /api/invoices — miroir de createInvoice() (retourne juste l'id, comme l'original)
invoicesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const id = await withUserContext(req.authUser!, async (client) => {
      const insert = buildInsert('invoices', INVOICE_COLUMNS, normalizeJsonColumns(req.body), 'id');
      const { rows } = await client.query(insert.text, insert.values);
      return rows[0].id;
    });
    res.status(201).json({ id });
  }),
);

// PATCH /api/invoices/:id — miroir de updateInvoice()
invoicesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const invoice = await withUserContext(req.authUser!, async (client) => {
      const update = buildUpdate('invoices', INVOICE_COLUMNS, normalizeJsonColumns(req.body), 'id', req.params.id);
      if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
      const { rows } = await client.query(update.text, update.values);
      return rows[0];
    });
    res.json(invoice);
  }),
);

// DELETE /api/invoices/:id — miroir de deleteInvoice()
invoicesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withUserContext(req.authUser!, (client) => client.query('DELETE FROM invoices WHERE id = $1', [req.params.id]));
    res.status(204).end();
  }),
);

// POST /api/invoices/:id/cancel — miroir de cancelInvoice()
invoicesRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason, cancelledBy } = req.body as { reason: string; cancelledBy: string };
    await withUserContext(req.authUser!, (client) =>
      client.query(
        `UPDATE invoices SET status = 'cancelled', cancelled_at = now(),
                cancelled_by = $1, cancellation_reason = $2 WHERE id = $3`,
        [cancelledBy, reason, req.params.id],
      ),
    );
    res.status(204).end();
  }),
);

// POST /api/invoices/release-awaiting-payment — miroir de Caisse.tsx : une
// fois l'encaissement fait, les examens (labo/imagerie/analyses) en attente
// de paiement pour ce patient redeviennent visibles dans les files
// laboratoire/imagerie/analyses (awaiting_payment → pending), en une seule
// transaction plutôt que 3 requêtes séparées.
invoicesRouter.post(
  '/release-awaiting-payment',
  asyncHandler(async (req, res) => {
    const { structureId, patientId } = req.body as { structureId: string; patientId: string };
    await withUserContext(req.authUser!, (client) =>
      Promise.all([
        client.query(
          "UPDATE lab_tests SET status = 'pending', updated_at = now() WHERE structure_id = $1 AND patient_id = $2 AND status = 'awaiting_payment'",
          [structureId, patientId],
        ),
        client.query(
          "UPDATE imaging_tests SET status = 'pending', updated_at = now() WHERE structure_id = $1 AND patient_id = $2 AND status = 'awaiting_payment'",
          [structureId, patientId],
        ),
        client.query(
          "UPDATE analyse_orders SET status = 'pending', updated_at = now() WHERE structure_id = $1 AND patient_id = $2 AND status = 'awaiting_payment'",
          [structureId, patientId],
        ),
      ]),
    );
    res.status(204).end();
  }),
);
