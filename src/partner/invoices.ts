import { adminPool } from '../db.js';
import type { PartnerContext } from './auth.js';
import { pickAllowed, diffFields } from './whitelist.js';
import { badRequest, forbidden, notFound, ok, type HandlerResult } from './types.js';

const LIST_COLUMNS =
  'id, structure_id, patient_id, date, subtotal, tax, total, status, insurance_id, insurance_part, patient_part, tiers_payant, payment_method, hospitalization_id, created_at';
const DETAIL_COLUMNS = `${LIST_COLUMNS}, items, notes`;

// draft/cancelled restent des actions clinique-only (l'annulation a son propre
// flux audité, voir src/lib/db/invoices.ts cancelInvoice()).
const PARTNER_WRITABLE_STATUSES = ['pending', 'paid', 'patient_paid', 'partially_paid', 'insurance_paid'];
const WRITABLE_FIELDS = ['status', 'payment_method'] as const;

export async function listInvoices(url: URL, ctx: PartnerContext, includeItems: boolean): Promise<HandlerResult> {
  if (ctx.structureIds.length === 0) return ok({ data: [] });

  const status = url.searchParams.get('status');
  const insuranceId = url.searchParams.get('insurance_id');
  const since = url.searchParams.get('since');

  const conditions = ['structure_id = ANY($1)'];
  const values: unknown[] = [ctx.structureIds];
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
  if (insuranceId) { values.push(insuranceId); conditions.push(`insurance_id = $${values.length}`); }
  if (since) { values.push(since); conditions.push(`date >= $${values.length}`); }

  const { rows } = await adminPool.query(
    `SELECT ${includeItems ? DETAIL_COLUMNS : LIST_COLUMNS} FROM invoices
     WHERE ${conditions.join(' AND ')} ORDER BY date DESC LIMIT 200`,
    values,
  );
  return ok({ data: rows });
}

export async function getInvoice(id: string, ctx: PartnerContext, includeItems: boolean): Promise<HandlerResult> {
  const { rows } = await adminPool.query(
    `SELECT ${includeItems ? DETAIL_COLUMNS : LIST_COLUMNS} FROM invoices WHERE id = $1 LIMIT 1`,
    [id],
  );
  const data = rows[0];
  if (!data) return notFound('Facture introuvable');
  if (!ctx.structureIds.includes(data.structure_id)) return forbidden();
  return ok({ data });
}

export async function updateInvoiceStatus(id: string, ctx: PartnerContext, body: Record<string, unknown>): Promise<HandlerResult> {
  const { rows: existingRows } = await adminPool.query(
    'SELECT id, structure_id, status, payment_method FROM invoices WHERE id = $1 LIMIT 1',
    [id],
  );
  const existing = existingRows[0];
  if (!existing) return notFound('Facture introuvable');
  if (!ctx.structureIds.includes(existing.structure_id)) return forbidden();

  const { values, rejected } = pickAllowed(body, WRITABLE_FIELDS);
  if (rejected.length > 0) return badRequest(`Champs non modifiables via cette API : ${rejected.join(', ')}`);
  if (values.status !== undefined && !PARTNER_WRITABLE_STATUSES.includes(String(values.status))) {
    return badRequest(`status doit être l'un de : ${PARTNER_WRITABLE_STATUSES.join(', ')}`);
  }
  if (Object.keys(values).length === 0) return badRequest('Aucun champ modifiable fourni (status, payment_method)');

  const cols = Object.keys(values);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const params = [...cols.map((c) => values[c]), id];
  const { rows: updatedRows } = await adminPool.query(
    `UPDATE invoices SET ${setClause} WHERE id = $${params.length} RETURNING id, status, payment_method`,
    params,
  );

  return ok(
    { data: updatedRows[0] },
    { resourceType: 'invoices', resourceId: id, structureId: existing.structure_id, changedFields: diffFields(existing, values) },
  );
}
