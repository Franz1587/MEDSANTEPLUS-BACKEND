import { Router } from 'express';
import { withUserContext } from './db.js';
import { requireAuth } from './auth.js';
import { asyncHandler, buildInsert, buildUpdate } from './util.js';

interface CrudOptions {
  table: string;
  /** Colonnes autorisées en écriture (whitelist insert/update). */
  columns: readonly string[];
  /** Colonnes sélectionnées pour la liste principale ; '*' par défaut. */
  listSelect?: string;
  /** Colonne de tri pour la liste principale et la route "related". */
  orderBy?: string;
  defaultLimit?: number;
  /** Force updated_at = now() à chaque PATCH (plusieurs fichiers db/ le font). */
  touchUpdatedAt?: boolean;
  /** Ajoute GET /by-<relatedColumn>/:value quand fourni (ex: 'patient_id'). */
  relatedColumn?: string;
}

/** Fabrique un routeur CRUD pour les domaines qui suivent le pattern quasi
 *  systématique observé dans src/lib/db/*.ts : liste par structure_id,
 *  lecture par id, création, mise à jour, suppression — chaque requête
 *  passant par withUserContext() pour que les policies RLS existantes
 *  continuent d'isoler les données par établissement/rôle sans rien changer
 *  côté Postgres. Couvre la majorité des 28 fichiers db/ ; les domaines aux
 *  besoins spécifiques (patients, invoices, stock) gardent leur routeur dédié. */
export function simpleCrudRouter(opts: CrudOptions): Router {
  const router = Router();
  router.use(requireAuth);
  const select = opts.listSelect ?? '*';
  const order = opts.orderBy ?? 'created_at DESC';
  const limit = opts.defaultLimit ?? 200;

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { structureId, limit: qLimit } = req.query as { structureId?: string; limit?: string };
      if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
      const rows = await withUserContext(req.authUser!, (client) =>
        client.query(
          `SELECT ${select} FROM ${opts.table} WHERE structure_id = $1 ORDER BY ${order} LIMIT $2`,
          [structureId, Number(qLimit) || limit],
        ).then((r) => r.rows),
      );
      res.json(rows);
    }),
  );

  if (opts.relatedColumn) {
    router.get(
      `/by-${opts.relatedColumn}/:value`,
      asyncHandler(async (req, res) => {
        const rows = await withUserContext(req.authUser!, (client) =>
          client.query(
            `SELECT * FROM ${opts.table} WHERE ${opts.relatedColumn} = $1 ORDER BY ${order}`,
            [req.params.value],
          ).then((r) => r.rows),
        );
        res.json(rows);
      }),
    );
  }

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await withUserContext(req.authUser!, (client) =>
        client.query(`SELECT * FROM ${opts.table} WHERE id = $1 LIMIT 1`, [req.params.id]).then((r) => r.rows[0] ?? null),
      );
      res.json(row);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const row = await withUserContext(req.authUser!, async (client) => {
        const insert = buildInsert(opts.table, opts.columns, req.body);
        const { rows } = await client.query(insert.text, insert.values);
        return rows[0];
      });
      res.status(201).json(row);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await withUserContext(req.authUser!, async (client) => {
        const data = opts.touchUpdatedAt ? { ...req.body, updated_at: new Date().toISOString() } : req.body;
        const update = buildUpdate(opts.table, [...opts.columns, 'updated_at'], data, 'id', req.params.id);
        if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
        const { rows } = await client.query(update.text, update.values);
        return rows[0];
      });
      res.json(row);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await withUserContext(req.authUser!, (client) => client.query(`DELETE FROM ${opts.table} WHERE id = $1`, [req.params.id]));
      res.status(204).end();
    }),
  );

  return router;
}
