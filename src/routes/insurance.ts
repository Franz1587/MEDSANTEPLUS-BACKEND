import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

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

// Miroir de Hospitalizations.tsx (préchargement en lot des souscripteurs des
// patients hospitalisés) — GET /subscribers-by-ids?ids=a,b,c
insuranceRouter.get('/subscribers-by-ids', asyncHandler(async (req, res) => {
  const { ids } = req.query as { ids?: string };
  const idList = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (idList.length === 0) { res.json([]); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM insurance_subscribers WHERE id = ANY($1)', [idList]).then((r) => r.rows),
  );
  res.json(rows);
}));

// Miroir de Pharmacy.tsx (taux du souscripteur sélectionné en caisse)
insuranceRouter.get('/subscriber/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM insurance_subscribers WHERE id = $1 LIMIT 1', [req.params.id]).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// -- CRUD complet (SuperAdmin.tsx) -------------------------------------------

const COMPANY_COLUMNS = [
  'id', 'name', 'code', 'type', 'cnamgs_type', 'phone', 'email', 'address',
  'tiers_payant', 'coverage_default', 'taux_ambulatory', 'taux_hospitalisation',
  'plafond_chambre_jour', 'conventions', 'color', 'logo_url', 'service_tariffs',
  'urgence_tariffs',
] as const;

insuranceRouter.get('/companies-full', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT id,name,code,type,cnamgs_type,phone,email,address,tiers_payant,color,logo_url,created_at,service_tariffs
       FROM insurance_companies ORDER BY name`,
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

insuranceRouter.post('/companies', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('insurance_companies', COMPANY_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

insuranceRouter.patch('/companies/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('insurance_companies', COMPANY_COLUMNS, req.body, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

insuranceRouter.delete('/companies/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query('DELETE FROM insurance_companies WHERE id = $1', [req.params.id]),
  );
  res.status(204).end();
}));

const SUBSCRIBER_COLUMNS = [
  'insurance_id', 'name', 'registration_number', 'taux_ambulatory', 'taux_hospitalisation',
  'plafond_chambre', 'active',
] as const;

insuranceRouter.get('/subscribers-full/:insuranceId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM insurance_subscribers WHERE insurance_id = $1 ORDER BY name', [req.params.insuranceId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

insuranceRouter.post('/subscribers', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('insurance_subscribers', SUBSCRIBER_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

insuranceRouter.patch('/subscribers/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('insurance_subscribers', SUBSCRIBER_COLUMNS, req.body, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));
