// Clé publique du projet Supabase : ancienne clé « anon » (un JWT, retirée par Supabase début 2027) ou
// nouvelle clé « publishable » (`sb_publishable_…`). Les deux vont dans l'en-tête `apikey`. Seule l'ancienne
// est un JWT et peut aussi servir d'`Authorization: Bearer` : la nouvelle y serait refusée par le serveur.
// Les fonctions sans session (sync, photos, enrôlement…) sont en verify_jwt = false et s'authentifient par
// le jeton d'appareil ; celles qui exigent un JWT reçoivent la session du gérant.

/** Ancienne clé « anon » (JWT) ? */
export function isLegacyJwtKey(key: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key)
}

/** En-têtes d'un appel sans session gérant. */
export function publicKeyHeaders(key: string): Record<string, string> {
  return isLegacyJwtKey(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
}
