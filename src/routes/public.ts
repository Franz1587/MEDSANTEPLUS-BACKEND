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

// POST /public/portal-clinic-data — miroir de PatientPortal.tsx (RPC légère sans booking_config)
publicRouter.post('/portal-clinic-data', asyncHandler(async (req, res) => {
  const { slug } = req.body as { slug: string };
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query('SELECT get_portal_clinic_data($1) AS result', [slug]);
    return rows[0].result;
  });
  res.json(result);
}));

// GET /public/my-bookings?structureId=&email= — miroir de PatientPortal.tsx (mes rendez-vous)
publicRouter.get('/my-bookings', asyncHandler(async (req, res) => {
  const { structureId, email } = req.query as { structureId?: string; email?: string };
  if (!structureId || !email) { res.status(400).json({ error: 'structureId et email requis' }); return; }
  const rows = await withUserContext(null, (client) =>
    client.query(
      'SELECT * FROM booking_requests WHERE structure_id = $1 AND email = $2 ORDER BY created_at DESC',
      [structureId, email.toLowerCase()],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// POST /public/portal-login — miroir de PatientPortal.tsx (auth propre au portail patient,
// distincte du JWT staff : compare le hash déjà calculé côté client, ne retourne jamais
// password_hash au front).
publicRouter.post('/portal-login', asyncHandler(async (req, res) => {
  const { email, structureId, passwordHash } = req.body as { email: string; structureId: string; passwordHash: string };
  const row = await withUserContext(null, (client) =>
    client.query(
      `SELECT id, structure_id, first_name, last_name, email, phone, status, patient_id,
              has_insurance, insurance_id, insurance_policy_number, subscriber_company_id,
              is_cnamgs, cnamgs_type, nag_cnamgs, cnamgs_employer, reject_reason, created_at
       FROM patient_portal_accounts WHERE email = $1 AND structure_id = $2 AND password_hash = $3`,
      [email.trim().toLowerCase(), structureId, passwordHash],
    ).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// GET /public/portal-account-exists?structureId=&email= — vérifie l'unicité email à l'inscription
publicRouter.get('/portal-account-exists', asyncHandler(async (req, res) => {
  const { structureId, email } = req.query as { structureId?: string; email?: string };
  if (!structureId || !email) { res.status(400).json({ error: 'structureId et email requis' }); return; }
  const row = await withUserContext(null, (client) =>
    client.query(
      'SELECT id FROM patient_portal_accounts WHERE email = $1 AND structure_id = $2',
      [email.trim().toLowerCase(), structureId],
    ).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// GET /public/portal-insurers?structureId=... — assureurs liés à la clinique (inscription portail)
publicRouter.get('/portal-insurers', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(null, (client) =>
    client.query(
      `SELECT ic.id, ic.name, ic.type, ic.logo_url, ic.color
       FROM structure_insurance_links sil
       JOIN insurance_companies ic ON ic.id = sil.insurance_id
       WHERE sil.structure_id = $1 AND sil.active = true`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// GET /public/portal-subscribers — tous les souscripteurs actifs (inscription portail patient)
publicRouter.get('/portal-subscribers', asyncHandler(async (_req, res) => {
  const rows = await withUserContext(null, (client) =>
    client.query(
      "SELECT id, name, insurance_id FROM insurance_subscribers WHERE active = true ORDER BY name",
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// GET /public/default-structure — première structure avec booking activé (PublicBooking.tsx)
publicRouter.get('/default-structure', asyncHandler(async (_req, res) => {
  const row = await withUserContext(null, (client) =>
    client.query("SELECT id FROM structures WHERE booking_enabled = true LIMIT 1").then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// POST /public/booking-clinic-data — miroir de ClinicBooking.tsx (RPC léger sans images base64)
publicRouter.post('/booking-clinic-data', asyncHandler(async (req, res) => {
  const { slug } = req.body as { slug: string };
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query('SELECT get_booking_clinic_data($1) AS result', [slug]);
    return rows[0].result;
  });
  res.json(result);
}));

// POST /public/booking-clinic-images — lazy-load images base64 (ClinicBooking.tsx)
publicRouter.post('/booking-clinic-images', asyncHandler(async (req, res) => {
  const { slug } = req.body as { slug: string };
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query('SELECT get_booking_clinic_images($1) AS result', [slug]);
    return rows[0].result;
  });
  res.json(result);
}));

// GET /public/doctors?structureId=... — liste des médecins d'une clinique (ClinicBooking.tsx)
publicRouter.get('/doctors', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(null, (client) =>
    client.query(
      `SELECT id, first_name, last_name, specialization FROM staff
       WHERE structure_id = $1 AND role IN ('doctor', 'dentist', 'radiologist') AND status = 'active'
       ORDER BY last_name`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// GET /public/insurance-subscribers?insuranceId=... — souscripteurs d'un assureur (ClinicBooking.tsx)
publicRouter.get('/insurance-subscribers', asyncHandler(async (req, res) => {
  const { insuranceId } = req.query as { insuranceId?: string };
  if (!insuranceId) { res.status(400).json({ error: 'insuranceId requis' }); return; }
  const rows = await withUserContext(null, (client) =>
    client.query(
      'SELECT id, name, registration_number FROM insurance_subscribers WHERE insurance_id = $1 ORDER BY name',
      [insuranceId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

// POST /public/portal-patient-data — miroir de PatientPortal.tsx (compte portail + dossier lié)
publicRouter.post('/portal-patient-data', asyncHandler(async (req, res) => {
  const { portalAccountId, structureId } = req.body as { portalAccountId: string; structureId: string };
  const result = await withUserContext(null, async (client) => {
    const { rows } = await client.query('SELECT get_portal_patient_data($1, $2) AS result', [portalAccountId, structureId]);
    return rows[0].result;
  });
  res.json(result);
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
