import { Router } from 'express';
import { withUserContext } from '../db.js';
import { asyncHandler, buildInsert } from '../util.js';

/**
 * Routes accessibles sans authentification — pages publiques (PublicBooking.tsx,
 * ClinicBooking.tsx) appelées par de vrais patients anonymes, jamais montées
 * derrière requireAuth. withUserContext(null, ...) positionne le rôle Postgres
 * sur `anon`, exactement comme le faisait le client Supabase avec la clé anon :
 * les policies RLS existantes (ex: booking_requests_public_insert, WITH CHECK
 * true) s'appliquent donc sans aucune réécriture.
 */
export const publicRouter = Router();

const BOOKING_COLUMNS = [
  'structure_id', 'ref_number', 'first_name', 'last_name', 'phone', 'whatsapp', 'email',
  'type', 'specialty', 'reason', 'preferred_date', 'preferred_time', 'has_insurance',
  'insurance_id', 'insurance_name', 'insurance_policy_number', 'subscriber_company_id',
  'subscriber_company_name', 'is_cnamgs', 'cnamgs_type', 'nag_cnamgs', 'cnamgs_employer',
  'assigned_doctor_id', 'notify_sms', 'notify_whatsapp', 'notify_email', 'status',
  'patient_portal_account_id',
] as const;

// POST /public/booking-requests — miroir de PublicBooking.tsx ET ClinicBooking.tsx.
// ref_number n'a pas de DEFAULT en base (voir partner/appointments.ts pour le
// même constat) : PublicBooking.tsx ne l'a jamais envoyé (bug déjà présent en
// prod, les soumissions échouaient silencieusement en NOT NULL) — généré ici
// quand absent, ce qui corrige ce chemin sans changer le comportement de
// ClinicBooking.tsx qui fournit déjà sa propre référence.
publicRouter.post('/booking-requests', asyncHandler(async (req, res) => {
  const body = { ...req.body } as Record<string, unknown>;
  const row = await withUserContext(null, async (client) => {
    if (!body.ref_number) {
      const { rows: refRows } = await client.query(
        "SELECT 'RDV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('booking_ref_seq')::text, 4, '0') AS ref",
      );
      body.ref_number = refRows[0].ref;
    }
    const insert = buildInsert('booking_requests', BOOKING_COLUMNS, body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

publicRouter.post('/check-pharmacy-stock', asyncHandler(async (req, res) => {
  const { slug, query } = req.body as { slug: string; query: string };
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query('SELECT check_pharmacy_stock($1, $2) AS result', [slug, query]);
    return rows[0].result;
  });
  res.json(result);
}));

publicRouter.post('/register-booking-patient', asyncHandler(async (req, res) => {
  const p = req.body as Record<string, unknown>;
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query(
      `SELECT register_booking_patient($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result`,
      [
        p.structureId, p.firstName, p.lastName, p.phone, p.email, p.passwordHash,
        p.hasInsurance, p.insuranceId ?? '', p.insurancePolicyNumber ?? '',
        p.isCnamgs, p.cnamgsType ?? '', p.nagCnamgs ?? '', p.cnamgsEmployer ?? '',
        p.subscriberCompanyId ?? '',
      ],
    );
    return rows[0].result;
  });
  res.json(result);
}));
