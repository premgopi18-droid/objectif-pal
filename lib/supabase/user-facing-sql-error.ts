import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";

/**
 * Le préfixe qui marque un `raise exception` SQL **destiné à l'écran**.
 *
 * Sans convention explicite, tout `raise exception` finirait affiché à
 * l'utilisateur — y compris celui qu'un futur contributeur ajouterait pour une
 * raison technique. On ne remonte donc QUE les messages qui se présentent, et
 * on retire le préfixe avant l'affichage. Partagé par toutes les RPC métier
 * (fusion de livres #100, référentiel de séries #291).
 */
export const SQL_USER_MESSAGE_PREFIX = "UX: ";
/** Le code PostgreSQL d'un `raise exception` sans `errcode` explicite. */
export const POSTGRES_RAISE_EXCEPTION = "P0001";

/**
 * Un échec de RPC → le message à montrer. Tout ce qui n'est pas un refus
 * métier explicitement marqué part sur le message générique : une panne ne
 * doit jamais exposer d'interne (§8).
 */
export function userFacingSqlError(code: string | undefined, message: string): string {
  if (code !== POSTGRES_RAISE_EXCEPTION || !message.includes(SQL_USER_MESSAGE_PREFIX)) {
    return GENERIC_ERROR_MESSAGE;
  }
  // PostgREST peut préfixer le message ; on repart du marqueur, pas du début.
  return message.slice(message.indexOf(SQL_USER_MESSAGE_PREFIX) + SQL_USER_MESSAGE_PREFIX.length).trim();
}
