import { adminPool } from '../db.js';
import type { PartnerContext } from './auth.js';
import { badRequest, notFound, ok, type HandlerResult } from './types.js';

/** GET /eligibility?nag=...  ou  ?policy_number=... */
export async function getEligibility(url: URL, ctx: PartnerContext): Promise<HandlerResult> {
  const nag = url.searchParams.get('nag');
  const policyNumber = url.searchParams.get('policy_number');
  if (!nag && !policyNumber) return badRequest('Fournissez le paramètre nag ou policy_number');
  if (ctx.structureIds.length === 0) return ok({ data: [] });

  const filterCol = nag ? 'nag' : 'policy_number';
  const { rows } = await adminPool.query(
    `SELECT l.id, l.structure_id, l.patient_id, l.insurance_company_id, l.insurance_name,
            l.subscriber_company_id, l.subscriber_company_name, l.role, l.relationship,
            l.main_subscriber_first_name, l.main_subscriber_last_name,
            l.policy_number, l.nag, l.coverage_rate, l.is_cnamgs, l.cnamgs_type,
            l.affection_type, l.valid_until, l.is_active,
            jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'date_of_birth', p.date_of_birth, 'gender', p.gender) AS patients
     FROM patient_insurance_links l
     LEFT JOIN patients p ON p.id = l.patient_id AND p.structure_id = l.structure_id
     WHERE l.structure_id = ANY($1) AND l.is_active = true AND l.${filterCol} = $2`,
    [ctx.structureIds, nag ?? policyNumber],
  );
  return ok({ data: rows });
}

/** GET /subscribers?insurance_id=... — référentiel global, pas de scoping clinique. */
export async function listSubscribers(url: URL): Promise<HandlerResult> {
  const insuranceId = url.searchParams.get('insurance_id');
  const { rows } = await adminPool.query(
    `SELECT id, insurance_id, name, registration_number, taux_ambulatory, taux_hospitalisation, plafond_chambre, active, created_at
     FROM insurance_subscribers
     WHERE ($1::text IS NULL OR insurance_id = $1)
     ORDER BY name`,
    [insuranceId],
  );
  return ok({ data: rows });
}

/** POST /subscribers — création seule, jamais d'édition via cette API (voir _shared d'origine). */
export async function createSubscriber(body: Record<string, unknown>): Promise<HandlerResult> {
  const name = String(body.name ?? '').trim();
  const insuranceId = String(body.insurance_id ?? '').trim();
  if (!name) return badRequest('name est requis');
  if (!insuranceId) return badRequest('insurance_id est requis');

  const tauxAmbulatory = Number(body.taux_ambulatory ?? 80);
  const tauxHospitalisation = Number(body.taux_hospitalisation ?? 100);
  const plafondChambre = Number(body.plafond_chambre ?? 0);

  const { rows } = await adminPool.query(
    `INSERT INTO insurance_subscribers (insurance_id, name, registration_number, taux_ambulatory, taux_hospitalisation, plafond_chambre, active)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     RETURNING id, insurance_id, name`,
    [
      insuranceId, name,
      body.registration_number ? String(body.registration_number) : null,
      Number.isFinite(tauxAmbulatory) ? tauxAmbulatory : 80,
      Number.isFinite(tauxHospitalisation) ? tauxHospitalisation : 100,
      Number.isFinite(plafondChambre) ? plafondChambre : 0,
    ],
  );
  const data = rows[0];
  return { status: 201, body: { data }, resourceType: 'insurance_subscribers', resourceId: data.id };
}

/** GET /tariffs?insurance_id=... */
export async function getTariffs(url: URL): Promise<HandlerResult> {
  const insuranceId = url.searchParams.get('insurance_id');
  if (!insuranceId) return badRequest('insurance_id est requis');
  const { rows } = await adminPool.query(
    `SELECT id, name, code, type, tiers_payant, coverage_default, taux_ambulatory, taux_hospitalisation, plafond_chambre_jour, service_tariffs, urgence_tariffs
     FROM insurance_companies WHERE id = $1 LIMIT 1`,
    [insuranceId],
  );
  if (!rows[0]) return notFound("Compagnie d'assurance introuvable");
  return ok({ data: rows[0] });
}

/** GET /clinics — uniquement les cliniques du périmètre de cette clé. */
export async function listClinics(ctx: PartnerContext): Promise<HandlerResult> {
  if (ctx.structureIds.length === 0) return ok({ data: [] });
  const { rows } = await adminPool.query(
    `SELECT id, name, city, address, phone FROM structures WHERE id = ANY($1) ORDER BY name`,
    [ctx.structureIds],
  );
  return ok({ data: rows });
}
