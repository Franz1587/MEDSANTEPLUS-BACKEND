import { adminPool } from '../db.js';
import type { PartnerContext } from './auth.js';
import { pickAllowed, diffFields } from './whitelist.js';
import { badRequest, forbidden, notFound, ok, type HandlerResult } from './types.js';

const COLUMNS =
  'id, structure_id, ref, insurance_id, insurance_name, subscriber_company_id, souscripteur, period_start, period_end, prestation_ids, total_brut, total_tiers_payant, total_patient, status, created_at';

const WRITABLE_FIELDS = ['status'] as const;

// Un partenaire ne fait avancer un sinistre que vers l'avant, jamais un
// brouillon (interne clinique). Les états terminaux (rejete, paye) n'ont
// plus de transition possible.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  brouillon: [],
  soumis: ['approuve', 'rejete', 'paye'],
  approuve: ['paye'],
  rejete: [],
  paye: [],
};

export async function listClaims(url: URL, ctx: PartnerContext): Promise<HandlerResult> {
  if (ctx.structureIds.length === 0) return ok({ data: [] });

  const status = url.searchParams.get('status');
  const insuranceId = url.searchParams.get('insurance_id');
  const conditions = ['structure_id = ANY($1)'];
  const values: unknown[] = [ctx.structureIds];
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
  if (insuranceId) { values.push(insuranceId); conditions.push(`insurance_id = $${values.length}`); }

  const { rows } = await adminPool.query(
    `SELECT ${COLUMNS} FROM insurance_statements WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    values,
  );
  return ok({ data: rows });
}

export async function getClaim(id: string, ctx: PartnerContext): Promise<HandlerResult> {
  const { rows } = await adminPool.query(`SELECT ${COLUMNS} FROM insurance_statements WHERE id = $1 LIMIT 1`, [id]);
  const data = rows[0];
  if (!data) return notFound('Sinistre introuvable');
  if (!ctx.structureIds.includes(data.structure_id)) return forbidden();

  const prestationIds: string[] = data.prestation_ids ?? [];
  let invoices: unknown[] = [];
  if (prestationIds.length > 0) {
    const { rows: invRows } = await adminPool.query(
      `SELECT id, patient_id, date, total, insurance_part, patient_part, status FROM invoices WHERE id = ANY($1)`,
      [prestationIds],
    );
    invoices = invRows;
  }
  return ok({ data: { ...data, invoices } });
}

export async function updateClaimStatus(id: string, ctx: PartnerContext, body: Record<string, unknown>): Promise<HandlerResult> {
  const { rows: existingRows } = await adminPool.query(
    'SELECT id, structure_id, status FROM insurance_statements WHERE id = $1 LIMIT 1',
    [id],
  );
  const existing = existingRows[0];
  if (!existing) return notFound('Sinistre introuvable');
  if (!ctx.structureIds.includes(existing.structure_id)) return forbidden();

  const { values, rejected } = pickAllowed(body, WRITABLE_FIELDS);
  if (rejected.length > 0) return badRequest(`Champs non modifiables via cette API : ${rejected.join(', ')}`);
  const nextStatus = values.status !== undefined ? String(values.status) : undefined;
  if (!nextStatus) return badRequest('status est requis');

  const allowedNext = ALLOWED_TRANSITIONS[existing.status] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return badRequest(
      `Transition invalide : ${existing.status} → ${nextStatus}. Transitions autorisées depuis "${existing.status}" : ${allowedNext.length ? allowedNext.join(', ') : 'aucune'}`,
    );
  }

  const { rows: updatedRows } = await adminPool.query(
    'UPDATE insurance_statements SET status = $1 WHERE id = $2 RETURNING id, status',
    [nextStatus, id],
  );

  return ok(
    { data: updatedRows[0] },
    { resourceType: 'insurance_statements', resourceId: id, structureId: existing.structure_id, changedFields: diffFields(existing, { status: nextStatus }) },
  );
}
