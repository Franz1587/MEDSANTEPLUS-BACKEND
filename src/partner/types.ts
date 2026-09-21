// Miroir de supabase/functions/partner-api/_shared/types.ts

export interface HandlerResult {
  status: number;
  body: unknown;
  resourceType?: string;
  resourceId?: string;
  structureId?: string | null;
  changedFields?: Record<string, { from: unknown; to: unknown }> | null;
}

export function ok(body: unknown, extra: Partial<HandlerResult> = {}): HandlerResult {
  return { status: 200, body, ...extra };
}

export function badRequest(error: string, extra: Partial<HandlerResult> = {}): HandlerResult {
  return { status: 400, body: { error }, ...extra };
}

export function notFound(error = 'Introuvable'): HandlerResult {
  return { status: 404, body: { error } };
}

export function forbidden(error = 'Accès refusé à cette ressource'): HandlerResult {
  return { status: 403, body: { error } };
}
