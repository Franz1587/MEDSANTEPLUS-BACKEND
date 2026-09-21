import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const actTypesRouter = Router();
actTypesRouter.use(requireAuth);

const ACT_TYPE_COLUMNS = ['id', 'structure_id', 'category', 'label', 'code', 'default_price', 'is_active', 'created_at', 'updated_at'] as const;

// Miroir de fetchActTypes() — actes propres à la structure + actes globaux (structure_id NULL)
actTypesRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT * FROM act_types WHERE (structure_id = $1 OR structure_id IS NULL) AND is_active = true
       ORDER BY category, label`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

actTypesRouter.post('/', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('act_types', ACT_TYPE_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

actTypesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('act_types', [...ACT_TYPE_COLUMNS, 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// Miroir de deleteActType() — désactivation logique, pas de suppression réelle.
actTypesRouter.delete('/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query("UPDATE act_types SET is_active = false, updated_at = now() WHERE id = $1", [req.params.id]),
  );
  res.status(204).end();
}));
