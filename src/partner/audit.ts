import { adminPool } from '../db.js';

export interface AuditEntry {
  partnerKeyId: string | null;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  structureId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  changedFields?: Record<string, { from: unknown; to: unknown }> | null;
  errorMessage?: string | null;
}

export async function logCall(entry: AuditEntry): Promise<void> {
  try {
    await adminPool.query(
      `INSERT INTO partner_api_audit_log
         (partner_key_id, method, route, status_code, duration_ms, structure_id, resource_type, resource_id, changed_fields, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entry.partnerKeyId, entry.method, entry.route, entry.statusCode, entry.durationMs,
        entry.structureId ?? null, entry.resourceType ?? null, entry.resourceId ?? null,
        entry.changedFields ? JSON.stringify(entry.changedFields) : null, entry.errorMessage ?? null,
      ],
    );
  } catch (e) {
    // L'audit ne doit jamais faire échouer la réponse réelle.
    console.error('[partner-api] audit log write failed:', e);
  }
}
