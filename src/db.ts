import { Pool, type PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

/**
 * Exécute une requête dans une transaction où l'identité de l'utilisateur
 * authentifié est posée via SET LOCAL — Postgres applique alors les mêmes
 * règles RLS que celles utilisées aujourd'hui sous PostgREST, sans qu'aucune
 * politique n'ait besoin d'être dupliquée ou réécrite côté backend.
 */
export async function withUserContext<T>(
  user: { id: string; role: string } | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (user) {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query('SET LOCAL request.jwt.claims = $1', [
        JSON.stringify({ sub: user.id, role: 'authenticated' }),
      ]);
    } else {
      await client.query('SET LOCAL ROLE anon');
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
