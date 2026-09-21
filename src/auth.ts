import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET manquant');

export interface AuthUser {
  id: string;
}

export function signToken(userId: string): string {
  // sub = auth.uid() côté Postgres — doit rester un UUID brut, sans autre claim
  // nécessaire pour les policies RLS existantes (voir withUserContext()).
  return jwt.sign({ sub: userId, role: 'authenticated' }, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    return { id: payload.sub };
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/** Exige un JWT valide ; sinon 401. Pose req.authUser pour les handlers suivants. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  req.authUser = user;
  next();
}

/** Comme requireAuth, mais laisse passer les requêtes anonymes (req.authUser reste
 *  undefined) — utile pour les rares endpoints publics qui doivent malgré tout
 *  refléter les policies RLS du rôle "anon". */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const user = verifyToken(token);
    if (user) req.authUser = user;
  }
  next();
}
