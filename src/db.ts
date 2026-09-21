import { Pool, type PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

/** Pool élevé (rôle postgres) — réservé aux besoins qui ne peuvent pas
 *  passer par le rôle authenticator, en premier lieu la vérification du mot
 *  de passe au login : auth.users n'est lisible que par postgres, jamais par
 *  authenticated/anon (verrouillé ainsi par Supabase lui-même). Ne jamais
 *  utiliser ce pool pour une requête dont le contenu dépend de l'utilisateur
 *  authentifié — cela court-circuiterait les policies RLS. */
export const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 5,
});

/**
 * Exécute une requête dans une transaction où l'identité de l'utilisateur
 * authentifié est posée via SET LOCAL — Postgres applique alors les mêmes
 * règles RLS que celles utilisées aujourd'hui sous PostgREST, sans qu'aucune
 * politique n'ait besoin d'être dupliquée ou réécrite côté backend.
 */
export async function withUserContext<T>(
  user: { id: string } | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (user) {
      await client.query('SET LOCAL ROLE authenticated');
      // set_config(..., true) = portée transaction, équivalent à SET LOCAL mais
      // paramétrable — "SET LOCAL x = $1" n'est pas une syntaxe SQL valide.
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
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
