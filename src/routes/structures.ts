import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildUpdate } from '../util.js';

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
