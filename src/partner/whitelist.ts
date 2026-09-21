// Miroir de supabase/functions/partner-api/_shared/whitelist.ts — un PATCH
// partenaire ne passe jamais par un UPDATE générique, uniquement par ces
// listes blanches de colonnes.

export function pickAllowed(
  body: Record<string, unknown>,
  allowed: readonly string[],
): { values: Record<string, unknown>; rejected: string[] } {
  const values: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const key of Object.keys(body)) {
    if (allowed.includes(key)) values[key] = body[key];
    else rejected.push(key);
  }
  return { values, rejected };
}

export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) diff[key] = { from: before[key] ?? null, to: after[key] };
  }
  return diff;
}
