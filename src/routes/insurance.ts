import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const insuranceRouter = Router();
insuranceRouter.use(requireAuth);

// Miroir de src/lib/db/insurance.ts — tables de référence globales, pas de
// scope par structure_id (visibles par toute structure sous RLS existante).
insuranceRouter.get('/companies', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT id,name,code,type,phone,email,address,tiers_payant,coverage_default,taux_ambulatory,
              taux_hospitalisation,plafond_chambre_jour,conventions,color,logo_url,cnamgs_type,
              service_tariffs,urgence_tariffs,created_at
       FROM insurance_companies ORDER BY name`,
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

insuranceRouter.get('/companies/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM insurance_companies WHERE id = $1', [req.params.id]).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

insuranceRouter.get('/subscribers', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT id, name, insurance_id FROM insurance_subscribers ORDER BY name').then((r) => r.rows),
  );
  // Miroir exact de fetchSubscriberCompanies() : reforme la shape SubscriberCompany
  // attendue par le front (insurer_id au lieu de insurance_id, champs par défaut).
  res.json(rows.map((row) => ({
    id: row.id, name: row.name, insurer_id: row.insurance_id,
    sector: 'private', phone: null, email: null, contract_ref: null,
  })));
}));
