import pg, { Pool, type PoolClient } from 'pg';

// `pg` renvoie NUMERIC/DECIMAL (OID 1700) et BIGINT (OID 20) sous forme de
// chaînes par défaut (pour ne pas perdre de précision sur de très grands
// entiers) — mais PostgREST, lui, les renvoyait en JSON comme de vrais
// nombres. Sans ce correctif, tout calcul arithmétique côté front sur un
// champ numeric (subtotal, tax, total, insurance_part, taux_*, prix...)
// fait de la concaténation de chaînes au lieu d'une addition (ex: montant
// total affiché "NaN FCFA"). Nos montants FCFA et compteurs restent bien en
// deçà de Number.MAX_SAFE_INTEGER, donc aucun risque de perte de précision.
pg.types.setTypeParser(1700, (val: string) => (val === null ? null : parseFloat(val)));
pg.types.setTypeParser(20, (val: string) => (val === null ? null : parseInt(val, 10)));

// `pg` parse aussi les colonnes DATE (OID 1082, sans heure — date_of_birth,
// invoices.date, hospitalizations.admission_date, etc.) en objet Date JS à
// minuit LOCAL, puis JSON.stringify() le sérialise en horodatage ISO complet
// ("2001-02-15T00:00:00.000Z") au lieu de la simple date ("2001-02-15") que
// renvoyait PostgREST. Le front concatène souvent `dateOfBirth + 'T00:00'`
// en supposant une date nue : sur l'horodatage complet ça donne
// "...000ZT00:00", un Date invalide (affiché "date de naissance invalide").
// On garde donc la chaîne brute Postgres telle quelle, sans conversion.
pg.types.setTypeParser(1082, (val: string) => val);

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
