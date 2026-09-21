import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

// Miroir de src/lib/db/rooms.ts — l'embed PostgREST room_categories(...)
// devient un LEFT JOIN + json_build_object, agrégé en un seul aller-retour
// comme le faisait la couche REST.
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
