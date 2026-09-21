import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const patientsRouter = Router();
patientsRouter.use(requireAuth);

/** Colonnes autorisées en écriture — miroir de PatientInsert/PatientUpdate
 *  dans src/lib/database.types.ts côté frontend. */
const PATIENT_COLUMNS = [
  'id', 'structure_id', 'first_name', 'last_name', 'date_of_birth', 'gender',
  'phone', 'email', 'address', 'blood_type', 'allergies', 'chronic_diseases',
  'emergency_contact', 'insurance', 'portal_account_id', 'created_at', 'updated_at',
] as const;

// GET /api/patients?structureId=... — miroir de fetchPatients()
patientsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { structureId } = req.query as { structureId?: string };
    if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        `SELECT id,first_name,last_name,date_of_birth,gender,phone,email,address,blood_type,
                allergies,chronic_diseases,emergency_contact,insurance,created_at
         FROM patients WHERE structure_id = $1 ORDER BY last_name ASC`,
        [structureId],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// GET /api/patients/search?structureId=...&q=... — miroir de searchPatients()
patientsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { structureId, q } = req.query as { structureId?: string; q?: string };
    if (!structureId || !q) { res.status(400).json({ error: 'structureId et q requis' }); return; }
    const like = `%${q}%`;
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        `SELECT * FROM patients WHERE structure_id = $1
         AND (first_name ILIKE $2 OR last_name ILIKE $2 OR phone ILIKE $2)
         ORDER BY last_name LIMIT 50`,
        [structureId, like],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// POST /api/patients/find-duplicate — miroir de findDuplicatePatient()
patientsRouter.post(
  '/find-duplicate',
  asyncHandler(async (req, res) => {
    const { structureId, firstName, lastName, dateOfBirth, phone } = req.body as Record<string, string>;
    const normalizedPhone = (phone ?? '').trim().replace(/\s+/g, '');
    const fn = (firstName ?? '').trim();
    const ln = (lastName ?? '').trim();
    const patient = await withUserContext(req.authUser!, async (client) => {
      const byDob = await client.query(
        `SELECT id,first_name,last_name,date_of_birth,gender,phone,email,address,blood_type,
                allergies,chronic_diseases,emergency_contact,insurance,created_at
         FROM patients WHERE structure_id = $1 AND first_name ILIKE $2 AND last_name ILIKE $3
         AND date_of_birth = $4 LIMIT 1`,
        [structureId, fn, ln, dateOfBirth],
      );
      if (byDob.rows[0]) return byDob.rows[0];
      if (!normalizedPhone || !fn || !ln) return null;
      const byPhone = await client.query(
        `SELECT id,first_name,last_name,date_of_birth,gender,phone,email,address,blood_type,
                allergies,chronic_diseases,emergency_contact,insurance,created_at
         FROM patients WHERE structure_id = $1 AND first_name ILIKE $2 AND last_name ILIKE $3
         AND phone = $4 LIMIT 1`,
        [structureId, fn, ln, normalizedPhone],
      );
      return byPhone.rows[0] ?? null;
    });
    res.json(patient);
  }),
);

// GET /api/patients/:id — miroir de fetchPatientById()
patientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await withUserContext(req.authUser!, (client) =>
      client.query('SELECT * FROM patients WHERE id = $1 LIMIT 1', [req.params.id]).then((r) => r.rows[0] ?? null),
    );
    res.json(row);
  }),
);

// POST /api/patients — miroir de createPatient() (id via generate_patient_id RPC)
patientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const patient = await withUserContext(req.authUser!, async (client) => {
      const { rows: idRows } = await client.query('SELECT generate_patient_id($1) AS id', [req.body.structure_id]);
      const insert = buildInsert('patients', PATIENT_COLUMNS, { ...req.body, id: idRows[0].id });
      const { rows } = await client.query(insert.text, insert.values);
      return rows[0];
    });
    res.status(201).json(patient);
  }),
);

// PATCH /api/patients/:id — miroir de updatePatient()
patientsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patient = await withUserContext(req.authUser!, async (client) => {
      const update = buildUpdate('patients', PATIENT_COLUMNS, req.body, 'id', req.params.id);
      if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
      await client.query(update.text, update.values);
      const { rows } = await client.query('SELECT * FROM patients WHERE id = $1 LIMIT 1', [req.params.id]);
      if (!rows[0]) throw new Error('La mise à jour a réussi, mais le patient ne peut pas être relu immédiatement.');
      return rows[0];
    });
    res.json(patient);
  }),
);

// DELETE /api/patients/:id — miroir de deletePatient()
patientsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withUserContext(req.authUser!, (client) => client.query('DELETE FROM patients WHERE id = $1', [req.params.id]));
    res.status(204).end();
  }),
);

// POST /api/patients/sync-main-subscriber — miroir de syncMainSubscriberAcrossSiblings()
patientsRouter.post(
  '/sync-main-subscriber',
  asyncHandler(async (req, res) => {
    const { structureId, mainFirstName, mainLastName, updatedFields, excludePatientId } = req.body as {
      structureId: string; mainFirstName: string; mainLastName: string;
      updatedFields: Record<string, unknown>; excludePatientId: string;
    };
    const fn = (mainFirstName ?? '').trim().toLowerCase();
    const ln = (mainLastName ?? '').trim().toLowerCase();
    if (!fn || !ln) { res.json([]); return; }

    const updated = await withUserContext(req.authUser!, async (client) => {
      const { rows } = await client.query(
        'SELECT id, insurance FROM patients WHERE structure_id = $1 AND id != $2',
        [structureId, excludePatientId],
      );
      const out: Array<{ id: string; insurance: Record<string, unknown> }> = [];
      for (const row of rows) {
        const ins = row.insurance as Record<string, unknown> | null;
        if (!ins || ins.insuranceType !== 'ayant_droit') continue;
        const mainSub = ins.mainSubscriber as Record<string, unknown> | undefined;
        if (!mainSub) continue;
        const sameName =
          String(mainSub.firstName ?? '').trim().toLowerCase() === fn &&
          String(mainSub.lastName ?? '').trim().toLowerCase() === ln;
        if (!sameName) continue;
        const newInsurance = { ...ins, mainSubscriber: { ...mainSub, ...updatedFields } };
        await client.query('UPDATE patients SET insurance = $1 WHERE id = $2', [JSON.stringify(newInsurance), row.id]);
        out.push({ id: row.id, insurance: newInsurance });
      }
      return out;
    });
    res.json(updated);
  }),
);
