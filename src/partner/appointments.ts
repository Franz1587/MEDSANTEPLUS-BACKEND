import { adminPool } from '../db.js';
import type { PartnerContext } from './auth.js';
import { badRequest, forbidden, notFound, ok, type HandlerResult } from './types.js';

/**
 * Un partenaire n'écrit jamais directement dans `appointments` (agenda réel) —
 * il crée une ligne `booking_requests`, exactement comme la page publique de
 * prise de rendez-vous, pour qu'un humain de la clinique triage toujours la
 * demande avant qu'elle devienne un vrai rendez-vous.
 */
export async function createAppointmentRequest(ctx: PartnerContext, body: Record<string, unknown>): Promise<HandlerResult> {
  const structureId = String(body.structure_id ?? '');
  const firstName = String(body.first_name ?? '').trim();
  const lastName = String(body.last_name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const reason = String(body.reason ?? '').trim();

  if (!structureId) return badRequest('structure_id est requis');
  if (!ctx.structureIds.includes(structureId)) return forbidden("Cette clinique n'est pas accessible avec cette clé");
  if (!firstName || !lastName) return badRequest('first_name et last_name sont requis');
  if (!phone) return badRequest('phone est requis');
  if (!reason) return badRequest('reason est requis');

  const type = body.type === 'specialist' ? 'specialist' : 'general';

  // ref_number n'a pas de DEFAULT au niveau colonne (ni sur medsanteplus-pg-local,
  // ni sur supabase-db en production — ce chemin de création n'avait jamais été
  // exercé en prod, 0 livraisons webhook à ce jour) ; on le génère nous-mêmes
  // avec la même séquence/format que src/lib/booking-per-clinic.sql.
  const { rows } = await adminPool.query(
    `INSERT INTO booking_requests
       (ref_number, structure_id, first_name, last_name, phone, whatsapp, email, type, specialty, reason,
        preferred_date, preferred_time, has_insurance, insurance_name, insurance_policy_number, notify_sms)
     VALUES ('RDV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('booking_ref_seq')::text, 4, '0'),
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,true)
     RETURNING id, ref_number, status`,
    [
      structureId, firstName, lastName, phone,
      body.whatsapp ? String(body.whatsapp) : null,
      body.email ? String(body.email) : null,
      type,
      body.specialty ? String(body.specialty) : null,
      reason,
      body.preferred_date ? String(body.preferred_date) : null,
      body.preferred_time ? String(body.preferred_time) : null,
      body.insurance_name ? String(body.insurance_name) : null,
      body.insurance_policy_number ? String(body.insurance_policy_number) : null,
    ],
  );
  const data = rows[0];
  return { status: 201, body: { data }, resourceType: 'booking_requests', resourceId: data.id, structureId };
}

export async function getAppointmentRequest(ref: string, ctx: PartnerContext): Promise<HandlerResult> {
  const { rows } = await adminPool.query(
    `SELECT id, ref_number, structure_id, status, confirmed_date, confirmed_time, created_at
     FROM booking_requests WHERE ref_number = $1 LIMIT 1`,
    [ref],
  );
  const data = rows[0];
  if (!data) return notFound('Demande de rendez-vous introuvable');
  if (!ctx.structureIds.includes(data.structure_id)) return forbidden();
  return ok({ data });
}

/** GET /appointments?patient_id=&structure_id= — rendez-vous confirmés uniquement. */
export async function listAppointments(url: URL, ctx: PartnerContext): Promise<HandlerResult> {
  const patientId = url.searchParams.get('patient_id');
  const structureId = url.searchParams.get('structure_id');
  if (!patientId) return badRequest('patient_id est requis');
  if (ctx.structureIds.length === 0) return ok({ data: [] });

  const conditions = ['patient_id = $1', 'structure_id = ANY($2)'];
  const values: unknown[] = [patientId, ctx.structureIds];
  if (structureId) { values.push(structureId); conditions.push(`structure_id = $${values.length}`); }

  const { rows } = await adminPool.query(
    `SELECT id, structure_id, patient_id, doctor_id, date, time, duration, type, status, created_at
     FROM appointments WHERE ${conditions.join(' AND ')} ORDER BY date DESC LIMIT 100`,
    values,
  );
  return ok({ data: rows });
}
