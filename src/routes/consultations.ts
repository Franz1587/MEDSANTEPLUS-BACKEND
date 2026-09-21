import { Router } from 'express';
import { simpleCrudRouter } from '../crud.js';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

// Miroir de src/lib/db/consultations.ts
export const consultationsRouter: Router = Router();

const DOCTOR_LIST_SELECT =
  'id,patient_id,doctor_id,date,chief_complaint,diagnosis,icd_codes,notes,vital_signs,prescriptions,treatment';

// fetchConsultationsByDoctor() — route spécifique, DOIT être déclarée avant
// le CRUD générique ci-dessous pour ne pas se faire intercepter par "GET /:id".
consultationsRouter.get('/by-doctor/:doctorId', requireAuth, asyncHandler(async (req, res) => {
  const { date, limit } = req.query as { date?: string; limit?: string };
  const rows = await withUserContext(req.authUser!, (client) => {
    const values: unknown[] = [req.params.doctorId];
    let where = 'doctor_id = $1';
    if (date) { values.push(date); where += ` AND date = $${values.length}`; }
    values.push(Number(limit) || 100);
    return client.query(
      `SELECT ${DOCTOR_LIST_SELECT} FROM consultations WHERE ${where} ORDER BY date DESC LIMIT $${values.length}`,
      values,
    ).then((r) => r.rows);
  });
  res.json(rows);
}));

consultationsRouter.use('/', simpleCrudRouter({
  table: 'consultations',
  columns: ['id', 'structure_id', 'patient_id', 'doctor_id', 'date', 'time', 'type', 'status', 'chief_complaint', 'diagnosis', 'notes', 'vital_signs', 'prescriptions', 'treatment', 'icd_codes', 'lab_test_ids', 'imaging_test_ids', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,doctor_id,date,type,status,chief_complaint,diagnosis,icd_codes,notes,vital_signs,prescriptions',
  orderBy: 'date DESC',
  relatedColumn: 'patient_id',
}));
