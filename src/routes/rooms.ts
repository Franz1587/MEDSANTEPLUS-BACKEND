import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

// Miroir de src/lib/db/rooms.ts — l'embed PostgREST room_categories(...)
// devient un LEFT JOIN + json_build_object, agrégé en un seul aller-retour
// comme le faisait la couche REST.
// Miroir de Hospitalizations.tsx / Logistics.tsx — liste des catégories de
// chambre (avant de rejoindre les chambres elles-mêmes, voir GET / ci-dessous).
roomsRouter.get('/categories', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM room_categories WHERE structure_id = $1 ORDER BY price_per_day', [structureId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

const CATEGORY_COLUMNS = ['structure_id', 'code', 'name', 'description', 'standard', 'price_per_day', 'amenities', 'max_occupancy', 'color'] as const;

roomsRouter.post('/categories', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('room_categories', CATEGORY_COLUMNS, req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

roomsRouter.patch('/categories/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('room_categories', CATEGORY_COLUMNS, req.body, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

roomsRouter.delete('/categories/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) => client.query('DELETE FROM room_categories WHERE id = $1', [req.params.id]));
  res.status(204).end();
}));

roomsRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT r.id, r.number, r.floor, r.department, r.status, r.beds, r.category_id,
              CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
                'id', c.id, 'name', c.name, 'standard', c.standard,
                'price_per_day', c.price_per_day, 'max_occupancy', c.max_occupancy
              ) END AS room_categories
       FROM logistic_rooms r
       LEFT JOIN room_categories c ON c.id = r.category_id
       WHERE r.structure_id = $1
       ORDER BY r.department, r.number`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));
