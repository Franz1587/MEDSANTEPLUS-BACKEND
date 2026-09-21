import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildUpdate } from '../util.js';

export const profilesRouter = Router();
profilesRouter.use(requireAuth);

const PROFILE_COLUMNS = [
  'username', 'full_name', 'role', 'role_label', 'description', 'structure_id',
  'structure_type', 'staff_id', 'avatar_url', 'force_password_change', 'extra_rights',
] as const;

// Miroir de fetchCurrentProfile() — l'identité vient déjà du JWT (req.authUser),
// pas besoin d'un second aller-retour supabase.auth.getUser().
profilesRouter.get('/me', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM profiles WHERE id = $1', [req.authUser!.id]).then((r) => r.rows[0] ?? null),
  );
  res.json(row);
}));

// Miroir de fetchProfilesByStructure()
profilesRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  const rows = await withUserContext(req.authUser!, (client) =>
    structureId
      ? client.query('SELECT * FROM profiles WHERE structure_id = $1 ORDER BY full_name', [structureId]).then((r) => r.rows)
      : client.query('SELECT * FROM profiles ORDER BY full_name').then((r) => r.rows), // fetchAllProfiles() — super_admin, RLS tranche
  );
  res.json(rows);
}));

// Lier un compte staff au profil d'un administrateur déjà existant (voir
// Administration.tsx handleCreateUser — cas "médecin également admin").
profilesRouter.patch('/by-username/:username', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('profiles', PROFILE_COLUMNS, req.body, 'username', req.params.username);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// Miroir de updateProfile()
profilesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('profiles', PROFILE_COLUMNS, req.body, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));
