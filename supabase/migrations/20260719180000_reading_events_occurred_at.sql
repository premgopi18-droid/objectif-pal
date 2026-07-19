-- reading_events.occurred_at doit refléter la date SÉMANTIQUE de la transition,
-- pas l'instant d'écriture (audit #20, item 🟡 ; prérequis du lot A de #30).
--
-- Le défaut de la colonne (now()) faussait toute saisie rétroactive : terminer
-- aujourd'hui une lecture finie le mois dernier créait un événement daté
-- d'aujourd'hui, et les futures stats « abandons & reprises par mois » (§4.5)
-- auraient menti sur tout historique importé.
--
-- Mapping retenu (justifié transition par transition — cf. lib/books/journal-actions.ts) :
--
--   • vers `finished`  → new.finished_at
--       La date de fin EST la date des points (§3) ; garantie non-nulle par la
--       contrainte readings_finished_has_date. Vaut à l'INSERT (import d'une
--       lecture déjà terminée) comme à l'UPDATE (reading/abandoned → finished).
--
--   • INSERT vers `reading`  → new.started_at
--       Un VRAI début de lecture : la date de début saisie (rétroactive permise,
--       §4.2). C'est le premier événement de la lecture.
--
--   • UPDATE vers `reading`  → now()
--       Une reprise (abandoned → reading) ou une réouverture (finished → reading).
--       started_at n'est PAS retouché par resumeReading/reopenReading : il date
--       l'ANCIEN début, pas la reprise. Aucune colonne ne date la reprise ; ces
--       gestes se font toujours en direct → now() est la date sémantique correcte.
--
--   • vers `abandoned`  → now()
--       Le schéma n'a pas de date d'abandon (§7). abandonReading se fait toujours
--       en direct → now() faute de mieux, et fidèle à la réalité du geste.
--
-- Note : occurred_at est un timestamptz, started_at/finished_at des `date` — le
-- cast donne minuit UTC du jour sémantique, donc le même mois calendaire que la
-- date source (cohérent avec le bilan). L'ordre CHRONOLOGIQUE réel des
-- transitions reste porté par la clé d'identité `id` (monotone à l'insertion),
-- occurred_at ne servant qu'à ranger un événement dans son mois.
--
-- `create or replace` : la fonction est remplacée EN PLACE, le trigger
-- on_reading_status_change reste attaché (on ne le retouche pas). Le corps garde
-- à l'identique la garde d'intégrité #20 (n'écrire qu'à l'INSERT ou à un vrai
-- changement d'état) ; seule la valeur de occurred_at devient explicite au lieu
-- de retomber sur le défaut now() de la colonne.

create or replace function public.append_reading_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- À l'INSERT, OLD n'existe pas : on écrit toujours. À l'UPDATE, uniquement
  -- si l'état change vraiment (modifier une note ne journalise rien).
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.reading_events (reading_id, user_id, status, occurred_at)
    values (
      new.id,
      new.user_id,
      new.status,
      case
        -- Terminée : la date de fin date les points (§3), toujours renseignée.
        when new.status = 'finished' then new.finished_at::timestamptz
        -- Vrai début (le premier événement de la lecture) : la date de début saisie.
        when new.status = 'reading' and tg_op = 'INSERT' then new.started_at::timestamptz
        -- Reprise/réouverture (UPDATE → reading) et abandon : aucune date dédiée,
        -- ces gestes se font en direct → now().
        else now()
      end
    );
  end if;
  return new;
end;
$$;
