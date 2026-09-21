import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { adminPool, withUserContext } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const authRouter = Router();

/** Résout le profil applicatif (rôle, structure, nom) une fois l'identité
 *  connue — passe par le pool RLS normal : un utilisateur peut toujours lire
 *  sa propre ligne `profiles` sous les policies existantes. */
async function loadProfile(userId: string) {
  return withUserContext({ id: userId }, async (client) => {
    const { rows } = await client.query('SELECT * FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    return rows[0] ?? null;
  });
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'email et password requis' });
      return;
    }

    const { rows } = await adminPool.query(
      'SELECT id, encrypted_password, banned_until FROM auth.users WHERE lower(email) = lower($1) LIMIT 1',
      [email],
    );
    const user = rows[0];
    if (!user || !user.encrypted_password) {
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }

    const valid = await bcrypt.compare(password, user.encrypted_password);
    if (!valid) {
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }

    if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
      res.status(403).json({ error: 'Compte suspendu' });
      return;
    }

    const token = signToken(user.id);
    const profile = await loadProfile(user.id);
    res.json({ token, user: { id: user.id, email }, profile });
  }),
);

authRouter.get(
  '/session',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const { rows } = await adminPool.query('SELECT id, email FROM auth.users WHERE id = $1 LIMIT 1', [userId]);
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'Session invalide' });
      return;
    }
    const profile = await loadProfile(userId);
    res.json({ user: { id: user.id, email: user.email }, profile });
  }),
);

authRouter.post('/logout', requireAuth, (_req, res) => {
  // JWT sans état : rien à invalider côté serveur pour l'instant, le client
  // efface son token. À faire évoluer vers une liste de révocation si un
  // besoin de déconnexion forcée immédiate apparaît.
  res.status(204).end();
});
