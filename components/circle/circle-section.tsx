"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  joinCircle,
  removeFriend,
  searchCircle,
  sendFriendRequest,
  type CircleProfile,
  type CircleSearchResult,
} from "@/lib/circle/actions";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "@/lib/profile/display-name";

/**
 * Le cercle sur la page Profil (specs §4.14, lot A) — la porte (confirmer son
 * pseudo), la recherche, les demandes reçues/envoyées et la liste d'amis.
 * Les listes viennent du serveur (props) et se rafraîchissent par
 * revalidation ; seuls les résultats de recherche vivent ici.
 */

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink " +
  "placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

const ROW_CLASS = "flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5";

const LIST_LABEL = "text-[13px] font-bold text-ink2";

type CircleSectionProps = {
  joined: boolean;
  currentDisplayName: string;
  friends: CircleProfile[];
  received: CircleProfile[];
  sent: CircleProfile[];
};

/** L'avatar rond du cercle — la photo si posée, sinon l'initiale sur dégradé (patron Profil). */
function CircleAvatar({ profile }: { profile: CircleProfile }) {
  if (profile.avatarUrl !== null) {
    return (
      <Image
        src={profile.avatarUrl}
        alt=""
        width={40}
        height={40}
        unoptimized
        className="size-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-grad text-base font-black text-bg0">
      {profile.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

export function CircleSection({ joined, currentDisplayName, friends, received, sent }: CircleSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // La porte : le pseudo à confirmer, pré-rempli avec l'actuel.
  const [pseudoInput, setPseudoInput] = useState(currentDisplayName);

  // La recherche : `null` = pas encore cherché (rien à afficher, pas même « aucun »).
  const [searchInput, setSearchInput] = useState("");
  const [results, setResults] = useState<CircleSearchResult[] | null>(null);

  // Le retrait d'un ami se confirme d'un second tap — sur la même ligne.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const runAction = (action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.message) setMessage(result.message);
    });
  };

  if (!joined) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink2">
          Compare tes bilans de mois clos avec tes amis — score, distinctions et titres terminés. Jamais tes
          notes ni tes avis, jamais le mois en cours.
        </p>
        <p className="text-sm text-ink2">
          Pour entrer, confirme ton pseudo : c&apos;est lui que tes amis chercheront, et lui seul sera visible.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeDisplayName(pseudoInput);
            if (!normalized.ok) {
              setError(normalized.error);
              return;
            }
            runAction(() => joinCircle(normalized.value));
          }}
        >
          <input
            value={pseudoInput}
            onChange={(event) => setPseudoInput(event.target.value)}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            aria-label="Pseudo pour le cercle"
            placeholder="Ton pseudo"
            className={INPUT_CLASS}
          />
          <Button type="submit" disabled={isPending}>
            Entrer au cercle
          </Button>
        </form>
        {error && <ErrorAlert message={error} />}
      </div>
    );
  }

  const updateResultRelation = (id: string, relation: CircleSearchResult["relation"]) => {
    setResults((current) =>
      current === null ? null : current.map((row) => (row.id === id ? { ...row, relation } : row)),
    );
  };

  const resultButton = (row: CircleSearchResult) => {
    switch (row.relation) {
      case "friend":
        return <span className="text-xs font-bold text-green">Déjà ami ✓</span>;
      case "sent":
        return <span className="text-xs font-bold text-ink3">Demande envoyée</span>;
      case "received":
        return (
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              runAction(async () => {
                const result = await acceptFriendRequest(row.id);
                if (result.ok) updateResultRelation(row.id, "friend");
                return result;
              })
            }
          >
            Accepter
          </Button>
        );
      case "none":
        return (
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              runAction(async () => {
                const result = await sendFriendRequest(row.id);
                if (result.ok) updateResultRelation(row.id, result.relation);
                return result;
              })
            }
          >
            Demander
          </Button>
        );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* L'entrée vers les bilans comparés (lot B) — dès qu'il y a un ami. */}
      {friends.length > 0 && (
        <Link
          href="/profil/cercle"
          className="bg-grad shadow-grad inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-bg0 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          Comparer nos bilans
        </Link>
      )}

      {/* La recherche — au geste (Entrée/bouton), jamais à la frappe : le quota
          n'est consommé que quand on cherche vraiment. */}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runAction(async () => {
            const result = await searchCircle(searchInput);
            if (result.ok) setResults(result.results);
            return result.ok ? { ok: true } : result;
          });
        }}
      >
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Chercher un pseudo"
          placeholder="Chercher un pseudo…"
          className={INPUT_CLASS}
        />
        <Button type="submit" variant="ghost" disabled={isPending}>
          Chercher
        </Button>
      </form>

      {results !== null && (
        <div className="flex flex-col gap-2">
          {results.length === 0 ? (
            <p className="text-sm text-ink3">Aucun compte trouvé — la recherche demande au moins 2 caractères, et ne voit que les comptes entrés au cercle.</p>
          ) : (
            results.map((row) => (
              <div key={row.id} className={ROW_CLASS}>
                <CircleAvatar profile={row} />
                <p className="min-w-0 flex-1 truncate text-sm font-bold">{row.displayName}</p>
                {resultButton(row)}
              </div>
            ))
          )}
        </div>
      )}

      {received.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className={LIST_LABEL}>
            Demandes reçues <span className="text-cyan">({received.length})</span>
          </p>
          {received.map((profile) => (
            <div key={profile.id} className={ROW_CLASS}>
              <CircleAvatar profile={profile} />
              <p className="min-w-0 flex-1 truncate text-sm font-bold">{profile.displayName}</p>
              <Button type="button" disabled={isPending} onClick={() => runAction(() => acceptFriendRequest(profile.id))}>
                Accepter
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={isPending}
                onClick={() => runAction(() => declineFriendRequest(profile.id))}
              >
                Refuser
              </Button>
            </div>
          ))}
        </div>
      )}

      {sent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className={LIST_LABEL}>Demandes envoyées</p>
          {sent.map((profile) => (
            <div key={profile.id} className={ROW_CLASS}>
              <CircleAvatar profile={profile} />
              <p className="min-w-0 flex-1 truncate text-sm font-bold">{profile.displayName}</p>
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => runAction(() => cancelFriendRequest(profile.id))}
              >
                Annuler
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className={LIST_LABEL}>
          Mes amis {friends.length > 0 && <span className="text-cyan">({friends.length})</span>}
        </p>
        {friends.length === 0 ? (
          <p className="text-sm text-ink3">
            Personne pour l&apos;instant — cherche un pseudo pour envoyer ta première demande.
          </p>
        ) : (
          friends.map((profile) => (
            <div key={profile.id} className={ROW_CLASS}>
              {/* La ligne mène à la fiche (lot B) : les bilans clos de l'ami. */}
              <Link
                href={`/profil/cercle/${profile.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              >
                <CircleAvatar profile={profile} />
                <p className="min-w-0 flex-1 truncate text-sm font-bold">{profile.displayName}</p>
              </Link>
              {confirmRemoveId === profile.id ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={isPending}
                    onClick={() =>
                      runAction(async () => {
                        const result = await removeFriend(profile.id);
                        if (result.ok) setConfirmRemoveId(null);
                        return result;
                      })
                    }
                  >
                    Confirmer
                  </Button>
                  <Button type="button" variant="ghost" disabled={isPending} onClick={() => setConfirmRemoveId(null)}>
                    Garder
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => setConfirmRemoveId(profile.id)}
                >
                  Retirer
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {message && <p className="text-sm font-medium text-green">{message}</p>}
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
