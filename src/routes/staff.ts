import { simpleCrudRouter } from '../crud.js';
import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

// Miroir de src/lib/db/staff.ts — colonnes alignées sur le SELECT réel de
// fetchStaff() (order_number/doctor_type/honoraire_rate/garde_amount
// existent en base mais manquent dans database.types.ts, généré et non à
// jour sur ce point).
export const staffRouter: Router = Router();

// fetchDoctors() — route spécifique, DOIT être déclarée avant le CRUD
// générique ci-dessous pour ne pas se faire intercepter par "GET /:id".
staffRouter.get('/doctors', requireAuth, asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT * FROM staff WHERE structure_id = $1
       AND role IN ('doctor','dentist','radiologist','sage_femme') AND status = 'active'
       ORDER BY last_name`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

staffRouter.use('/', simpleCrudRouter({
  table: 'staff',
  columns: ['id', 'structure_id', 'first_name', 'last_name', 'role', 'specialization', 'extra_specializations', 'order_number', 'department', 'phone', 'email', 'status', 'avatar_url', 'hire_date', 'doctor_type', 'honoraire_rate', 'garde_amount', 'created_at'],
  listSelect: 'id,first_name,last_name,role,specialization,extra_specializations,order_number,department,phone,email,status,hire_date,doctor_type,honoraire_rate,garde_amount',
  orderBy: 'last_name',
  defaultLimit: 1000,
}));
