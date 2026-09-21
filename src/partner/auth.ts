import crypto from 'node:crypto';
import type { Request } from 'express';
import { adminPool } from '../db.js';

/**
 * Miroir de supabase/functions/partner-api/_shared/auth.ts. Un partenaire
 * s'authentifie avec sa propre clé API (header X-Api-Key), jamais avec un
 * JWT applicatif — toujours via adminPool (rôle postgres), le scoping par
 * clinique se fait ici en JS via ctx.structureIds, pas par RLS.
 */

export interface PartnerContext {
  keyId: string;
  partnerName: string;
  scopes: string[];
  structureIds: string[];
}

export type AuthResult =
  | { ok: true; ctx: PartnerContext }
  | { ok: false; status: number; error: string };

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export async function authenticatePartner(req: Request): Promise<AuthResult> {
  const rawKey = req.headers['x-api-key'];
  if (!rawKey || typeof rawKey !== 'string') {
    return { ok: false, status: 401, error: 'X-Api-Key header manquant' };
  }

  const keyHash = sha256Hex(rawKey);
  const { rows } = await adminPool.query(
    `SELECT id, partner_name, scopes, status, expires_at, insurance_id, allowed_structure_ids
     FROM partner_api_keys WHERE key_hash = $1 LIMIT 1`,
    [keyHash],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 401, error: 'Clé API invalide' };
  if (row.status !== 'active') return { ok: false, status: 401, error: `Clé API ${row.status}` };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: 'Clé API expirée' };
  }

  const structureIds = await resolveStructureIds(row.insurance_id, row.allowed_structure_ids ?? []);

  // Best-effort — ne doit jamais bloquer la requête si cette écriture échoue.
  adminPool.query('UPDATE partner_api_keys SET last_used_at = now() WHERE id = $1', [row.id]).catch(() => {});

  return {
    ok: true,
    ctx: { keyId: row.id, partnerName: row.partner_name, scopes: row.scopes ?? [], structureIds },
  };
}

async function resolveStructureIds(insuranceId: string | null, allowedStructureIds: string[]): Promise<string[]> {
  if (!insuranceId) return allowedStructureIds;
  const { rows } = await adminPool.query(
    'SELECT structure_id FROM structure_insurance_links WHERE insurance_id = $1 AND active = true',
    [insuranceId],
  );
  return rows.map((r) => r.structure_id as string);
}

export function requireScope(ctx: PartnerContext, scope: string): AuthResult | null {
  if (ctx.scopes.includes(scope)) return null;
  return { ok: false, status: 403, error: `Portée manquante : ${scope}` };
}
