"use client";

import Link from "next/link";
import { use } from "react";

/**
 * La pastille de la boîte de finition (#101 lot C) — « N livres à compléter »,
 * lien vers /finition. UNE feuille partagée par le scan unitaire et la rafale.
 *
 * Fluidité #331 (item 5) : le compteur arrive du serveur en PROMESSE, lue ici
 * avec `use()` sous un `<Suspense>` posé par le parent — la caméra monte sans
 * l'attendre, la pastille apparaît quand le compte est là. Un nombre déjà
 * connu (la rafale, les tests) passe tel quel.
 *
 * `Link` et non `<a>` (#131) : un ancre brut rechargeait TOUTE l'app, splash
 * comprise. La phrase vit dans UNE expression : le découpage JSX mangeait
 * l'espace avant « à » (#130).
 */
export function PendingInboxLink({
  count,
  sessionBoxCount = 0,
  className = "",
}: {
  count: Promise<number> | number;
  /** En rafale : ce que la session vient d'ajouter à la boîte — le total le dit (#130). */
  sessionBoxCount?: number;
  className?: string;
}) {
  const pending = typeof count === "number" ? count : use(count);
  const total = pending + sessionBoxCount;
  if (total <= 0) return null;

  // Le total inclut la boîte d'AVANT la session — on le dit, sinon il a l'air doublé (#130).
  const sessionNote = sessionBoxCount > 0 && pending > 0 ? ` (dont ${pending} d'avant cette session)` : "";
  const tail = sessionBoxCount > 0 ? " — à faire quand tu veux, rien n'est perdu." : "";

  return (
    <Link
      href="/finition"
      className={`rounded-card border border-amber/40 bg-amber/10 p-3 text-sm text-ink underline underline-offset-2 ${className}`}
    >
      {`${total} livre${total > 1 ? "s" : ""} à compléter${sessionNote}${tail}`}
    </Link>
  );
}
