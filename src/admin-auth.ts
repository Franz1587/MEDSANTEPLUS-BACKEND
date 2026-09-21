import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { adminPool } from './db.js';

/**
 * Écritures directes sur auth.users, en remplacement de l'API
 * `supabase.auth.admin.*` — les Edge Functions create-staff-user/manage-user
 * l'utilisaient pour créer/suspendre/modifier des comptes. Le hash bcrypt
 * produit ici est lu par le login existant (voir routes/auth.ts), donc le
 * format doit rester compatible avec bcrypt.compare().
 */

const INSTANCE_ID = '00000000-0000-0000-0000-000000000000';

export async function createAuthUser(email: string, password: string): Promise<string> {
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  await adminPool.query(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, is_sso_user, is_anonymous
     ) VALUES (
       $1, $2, 'authenticated', 'authenticated', $3, $4,
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), false, false
     )`,
    [INSTANCE_ID, id, email.toLowerCase().trim(), hash],
  );
  return id;
}

export async function updateAuthUserPassword(id: string, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  await adminPool.query(
    'UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2',
    [hash, id],
  );
}

export async function updateAuthUserEmail(id: string, email: string): Promise<void> {
  await adminPool.query(
    'UPDATE auth.users SET email = $1, updated_at = now() WHERE id = $2',
    [email.toLowerCase().trim(), id],
  );
}

export async function banUser(id: string): Promise<void> {
  await adminPool.query(
    "UPDATE auth.users SET banned_until = now() + interval '876600 hours', updated_at = now() WHERE id = $1",
    [id],
  );
}

export async function unbanUser(id: string): Promise<void> {
  await adminPool.query(
    'UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = $1',
    [id],
  );
}

export async function deleteAuthUser(id: string): Promise<void> {
  await adminPool.query('DELETE FROM auth.users WHERE id = $1', [id]);
}
