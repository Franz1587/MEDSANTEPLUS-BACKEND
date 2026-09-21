import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Évite le try/catch répété dans chaque route — toute erreur async est
 *  transmise au middleware d'erreurs global (voir index.ts). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Construit un INSERT paramétré en ne retenant que les colonnes whitelistées
 *  présentes dans `data` — empêche l'injection de colonnes arbitraires depuis
 *  un corps de requête JSON non maîtrisé. */
export function buildInsert(
  table: string,
  allowedColumns: readonly string[],
  data: Record<string, unknown>,
  returning = '*',
): { text: string; values: unknown[] } {
  const cols = allowedColumns.filter((c) => data[c] !== undefined);
  if (cols.length === 0) throw new Error('Aucune colonne valide à insérer');
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map((c) => data[c]);
  return {
    text: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING ${returning}`,
    values,
  };
}

/** Construit un UPDATE paramétré, whitelist de colonnes identique à buildInsert. */
export function buildUpdate(
  table: string,
  allowedColumns: readonly string[],
  data: Record<string, unknown>,
  whereColumn: string,
  whereValue: unknown,
  returning = '*',
): { text: string; values: unknown[] } | null {
  const cols = allowedColumns.filter((c) => data[c] !== undefined);
  if (cols.length === 0) return null;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const values = cols.map((c) => data[c]);
  values.push(whereValue);
  return {
    text: `UPDATE ${table} SET ${sets.join(',')} WHERE ${whereColumn} = $${values.length} RETURNING ${returning}`,
    values,
  };
}
