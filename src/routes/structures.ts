import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const structuresRouter = Router();
structuresRouter.use(requireAuth);

// Miroir de src/lib/db/structures.ts — colonnes vérifiées directement en
// base (\d structures), plus complètes que database.types.ts sur ce point.
const STRUCTURE_COLUMNS = [
  'name', 'type', 'status', 'city', 'country', 'address', 'phone', 'email',
  'license_key', 'license_valid_until', 'admin_user_id', 'modules', 'users_count',
  'settings', 'subscription_plan', 'booking_slug', 'booking_enabled',
  'booking_config', 'clinic_code', 'fiscal_number', 'accreditation',
] as const;
const JSON_COLUMNS = ['modules', 'settings', 'booking_config'] as const;
function normalizeStructureJson(body: Record<string, unknown>) {
  const out = { ...body };
  for (const col of JSON_COLUMNS) {
    if (out[col] !== undefined && typeof out[col] !== 'string') out[col] = JSON.stringify(out[col]);
  }
  return out;
}

structuresRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM structures ORDER BY name').then((r) => r.rows),
  );
  res.json(rows);
}));

structuresRouter.get('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM structures WHERE id = $1', [req.params.id]).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

structuresRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('structures', STRUCTURE_COLUMNS, normalizeStructureJson(req.body), 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// POST /api/structures — miroir de handleCreateStructure() (SuperAdmin.tsx) :
// id généré par structures_seq (jamais transmis), retry côté serveur sur
// collision 23505/structures_pkey (séquence désynchronisée) plutôt que de
// remonter l'erreur Postgres brute au client.
structuresRouter.post('/', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const body = normalizeStructureJson(req.body);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const insert = buildInsert('structures', STRUCTURE_COLUMNS, body);
        const { rows } = await client.query(insert.text, insert.values);
        return rows[0];
      } catch (err) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr.code !== '23505' || !pgErr.message?.includes('structures_pkey')) throw err;
      }
    }
    throw new Error('Impossible de créer la structure (collision id, 5 tentatives échouées)');
  });
  res.status(201).json(row);
}));

// POST /api/structures/:id/seed-pharmacy-catalog — miroir du chargement du
// catalogue pharmacie par défaut dans handleCreateStructure() : copie
// entièrement côté serveur (une seule requête INSERT...SELECT) plutôt que
// 3800+ lignes rapatriées puis renvoyées une à une depuis le client.
structuresRouter.post('/:id/seed-pharmacy-catalog', asyncHandler(async (req, res) => {
  const count = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO stock_items
         (structure_id, name, generic_name, category, family, form, dosage, unit,
          current_stock, min_stock, unit_price, selling_price, purchase_price, cip_code)
       SELECT $1, name, generic_name, category, family, form, dosage, unit,
              30, min_stock, unit_price, unit_price, 0, cip_code
       FROM pharmacy_default_catalog
       RETURNING id`,
      [req.params.id],
    );
    return rows.length;
  });
  res.status(201).json({ count });
}));
