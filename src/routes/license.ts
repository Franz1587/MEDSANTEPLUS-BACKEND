import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

// Miroir des accès license_invoices / license_payments dans SuperAdmin.tsx —
// facturation de licence plateforme (pas les factures patients).
export const licenseRouter = Router();
licenseRouter.use(requireAuth);

const INVOICE_COLUMNS = [
  'invoice_ref', 'structure_id', 'structure_name', 'period', 'plan_type', 'plan_label',
  'payment_model', 'total_amount', 'status', 'paid_at', 'due_date', 'issue_date', 'notes',
  'advance_amount', 'advance_rubrique', 'net_amount', 'setup_fee_amount', 'setup_fee_description',
] as const;

const PAYMENT_COLUMNS = [
  'invoice_id', 'structure_id', 'structure_name', 'invoice_ref', 'period', 'amount', 'rubrique', 'payment_date', 'notes',
] as const;

// GET /api/license/invoices?structureId=... — miroir de fetchLicenseInvoices()
// (super_admin, toutes structures) ET de Settings.tsx (scopé à sa structure)
licenseRouter.get('/invoices', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  const rows = await withUserContext(req.authUser!, (client) =>
    structureId
      ? client.query('SELECT * FROM license_invoices WHERE structure_id = $1 ORDER BY period DESC', [structureId]).then((r) => r.rows)
      : client.query('SELECT * FROM license_invoices ORDER BY created_at DESC LIMIT 300').then((r) => r.rows),
  );
  res.json(rows);
}));

// POST /api/license/invoices/upsert — miroir de .upsert(..., {onConflict: 'structure_id,period'})
licenseRouter.post('/invoices/upsert', asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const row = await withUserContext(req.authUser!, async (client) => {
    const cols = INVOICE_COLUMNS.filter((c) => body[c] !== undefined);
    if (cols.length === 0) throw Object.assign(new Error('Aucune colonne valide à insérer'), { status: 400 });
    const values = cols.map((c) => body[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== 'structure_id' && c !== 'period').map((c) => `${c} = EXCLUDED.${c}`);
    const { rows } = await client.query(
      `INSERT INTO license_invoices (${cols.join(',')}) VALUES (${placeholders.join(',')})
       ON CONFLICT (structure_id, period) DO UPDATE SET ${updates.join(',')}, updated_at = now()
       RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.json(row);
}));

licenseRouter.patch('/invoices/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate(
      'license_invoices',
      [...INVOICE_COLUMNS, 'updated_at'],
      { ...req.body, updated_at: new Date().toISOString() },
      'id',
      req.params.id,
    );
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

licenseRouter.get('/payments', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM license_payments ORDER BY created_at DESC LIMIT 300').then((r) => r.rows),
  );
  res.json(rows);
}));

licenseRouter.get('/payments/by-structure/:structureId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM license_payments WHERE structure_id = $1 ORDER BY payment_date DESC', [req.params.structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

licenseRouter.post('/payments', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('license_payments', PAYMENT_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
