import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const stockRouter = Router();
stockRouter.use(requireAuth);

const STOCK_ITEM_COLUMNS = [
  'id', 'structure_id', 'name', 'generic_name', 'category', 'family', 'cip_code',
  'form', 'dosage', 'unit', 'current_stock', 'min_stock', 'unit_price',
  'selling_price', 'purchase_price', 'expiry_date', 'supplier', 'location',
  'created_at', 'updated_at',
] as const;

const STOCK_MOVEMENT_COLUMNS = [
  'id', 'structure_id', 'stock_item_id', 'type', 'quantity', 'unit_cost',
  'movement_date', 'reason', 'created_by', 'created_at',
] as const;

// GET /api/stock-items?structureId=... — miroir de fetchStock() (tout le catalogue,
// PostgREST/pg n'a plus de plafond de lignes ici puisqu'on ne passe plus par une
// API REST générique paginée par défaut à 1000).
stockRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { structureId } = req.query as { structureId?: string };
    if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        `SELECT id,name,generic_name,category,family,form,dosage,cip_code,unit,current_stock,
                min_stock,unit_price,selling_price,purchase_price,expiry_date,supplier,location
         FROM stock_items WHERE structure_id = $1 ORDER BY name`,
        [structureId],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// GET /api/stock-items/low-stock?structureId=... — miroir de fetchLowStock()
stockRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const { structureId } = req.query as { structureId?: string };
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        'SELECT * FROM stock_items WHERE structure_id = $1 AND current_stock <= min_stock ORDER BY name',
        [structureId],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }),
);

// POST /api/stock-items — miroir de createStockItem()
stockRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const item = await withUserContext(req.authUser!, async (client) => {
      const insert = buildInsert('stock_items', STOCK_ITEM_COLUMNS, req.body);
      const { rows } = await client.query(insert.text, insert.values);
      return rows[0];
    });
    res.status(201).json(item);
  }),
);

// PATCH /api/stock-items/:id — miroir de updateStockItem()
stockRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await withUserContext(req.authUser!, async (client) => {
      const update = buildUpdate('stock_items', STOCK_ITEM_COLUMNS, req.body, 'id', req.params.id);
      if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
      const { rows } = await client.query(update.text, update.values);
      return rows[0];
    });
    res.json(item);
  }),
);

// DELETE /api/stock-items/:id — miroir de deleteStockItem()
stockRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await withUserContext(req.authUser!, (client) => client.query('DELETE FROM stock_items WHERE id = $1', [req.params.id]));
    res.status(204).end();
  }),
);

// POST /api/stock-items/:id/adjust — miroir de adjustStock() { delta }
stockRouter.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const { delta } = req.body as { delta: number };
    const item = await withUserContext(req.authUser!, async (client) => {
      const { rows } = await client.query('SELECT current_stock FROM stock_items WHERE id = $1', [req.params.id]);
      const newStock = Math.max(0, (rows[0]?.current_stock ?? 0) + delta);
      const updated = await client.query(
        'UPDATE stock_items SET current_stock = $1 WHERE id = $2 RETURNING *',
        [newStock, req.params.id],
      );
      return updated.rows[0];
    });
    res.json(item);
  }),
);

// GET /api/stock-movements?structureId=...&stockItemId=... — miroir de fetchStockMovements()
stockRouter.get(
  '/movements',
  asyncHandler(async (req, res) => {
    const { structureId, stockItemId } = req.query as { structureId?: string; stockItemId?: string };
    const rows = await withUserContext(req.authUser!, (client) => {
      const conditions = ['structure_id = $1'];
      const values: unknown[] = [structureId];
      if (stockItemId) { conditions.push(`stock_item_id = $${values.length + 1}`); values.push(stockItemId); }
      return client.query(
        `SELECT * FROM stock_movements WHERE ${conditions.join(' AND ')} ORDER BY movement_date DESC`,
        values,
      ).then((r) => r.rows);
    });
    res.json(rows);
  }),
);

// POST /api/stock-movements — miroir de createStockMovement() (insère + ajuste le stock)
stockRouter.post(
  '/movements',
  asyncHandler(async (req, res) => {
    const movement = await withUserContext(req.authUser!, async (client) => {
      const insert = buildInsert('stock_movements', STOCK_MOVEMENT_COLUMNS, req.body);
      const { rows } = await client.query(insert.text, insert.values);
      const created = rows[0];
      const delta = created.type === 'in' ? created.quantity : -created.quantity;
      await client.query(
        'UPDATE stock_items SET current_stock = GREATEST(0, current_stock + $1) WHERE id = $2',
        [delta, created.stock_item_id],
      );
      return created;
    });
    res.status(201).json(movement);
  }),
);
