import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

/** Miroir de l'import CSV en masse (SuperAdmin.tsx, onglet Import/Export).
 *  Colonnes = schéma RÉEL des tables cibles (pas les champs que le CSV
 *  fournit) : les types "medicaments" (table `medications` inexistante) et
 *  "medecins" (profiles.id sans ligne auth.users correspondante) étaient déjà
 *  non-fonctionnels avant cette migration — cet endpoint reproduit fidèlement
 *  le même échec plutôt que d'inventer une nouvelle logique métier pour les
 *  réparer. Seul le type "actes" est réellement fonctionnel. */
export const superadminImportRouter = Router();
superadminImportRouter.use(requireAuth);

type ImportType = 'actes' | 'medicaments' | 'medecins' | 'patients';

const TABLE_BY_TYPE: Record<ImportType, string> = {
  actes: 'act_types',
  medicaments: 'medications',
  medecins: 'profiles',
  patients: 'patients',
};

// Colonnes réellement présentes sur la table cible (voir \d <table> en base).
const COLUMNS_BY_TYPE: Record<ImportType, readonly string[]> = {
  actes: ['code', 'label', 'category', 'default_price', 'is_active'],
  medicaments: ['code', 'name', 'form', 'dosage', 'category', 'unit_price', 'stock_quantity', 'expiry_date', 'is_active'],
  medecins: ['username', 'full_name', 'role', 'role_label', 'description', 'phone'],
  patients: ['id', 'structure_id', 'first_name', 'last_name', 'date_of_birth', 'gender', 'phone', 'address'],
};

// GET /api/superadmin-import/last-code?type=actes&prefix=CONS — auto-incrément des codes
superadminImportRouter.get('/last-code', asyncHandler(async (req, res) => {
  const { type, prefix } = req.query as { type?: ImportType; prefix?: string };
  if (!type || !TABLE_BY_TYPE[type]) { res.status(400).json({ error: 'type invalide' }); return; }
  const table = TABLE_BY_TYPE[type];
  const codeColumn = type === 'patients' ? 'id' : 'code';
  const row = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT ${codeColumn} FROM ${table} WHERE ${codeColumn} LIKE $1 ORDER BY ${codeColumn} DESC LIMIT 1`,
      [`${prefix ?? ''}%`],
    ).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// POST /api/superadmin-import/bulk { type, rows } — insertion par lots (500/lot côté appelant)
superadminImportRouter.post('/bulk', asyncHandler(async (req, res) => {
  const { type, rows: batch } = req.body as { type: ImportType; rows: Record<string, unknown>[] };
  if (!type || !TABLE_BY_TYPE[type]) { res.status(400).json({ error: 'type invalide' }); return; }
  if (!Array.isArray(batch) || batch.length === 0) { res.json([]); return; }
  const table = TABLE_BY_TYPE[type];
  const cols = COLUMNS_BY_TYPE[type].filter((c) => batch.every((r) => r[c] !== undefined));
  if (cols.length === 0) throw Object.assign(new Error('Aucune colonne valide à insérer'), { status: 400 });
  const values: unknown[] = [];
  const rowsSql = batch.map((row, i) => {
    const placeholders = cols.map((c, j) => {
      values.push(row[c] ?? null);
      return `$${i * cols.length + j + 1}`;
    });
    return `(${placeholders.join(',')})`;
  });
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${rowsSql.join(',')} RETURNING *`,
      values,
    ).then((r) => r.rows),
  );
  res.status(201).json(rows);
}));
