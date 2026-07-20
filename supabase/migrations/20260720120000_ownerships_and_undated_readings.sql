-- « Je possède » & « Déjà lu » — l'étagère d'avant l'app (issue #101, lot A).
--
-- Le cas manquant depuis le premier jour (specs §1) : posséder sans avoir
-- acheté DANS l'app. Sans lui, constituer sa PAL initiale obligeait à déclarer
-- 80 « achats », donc 80 malus −1 : le score plongeait à −80. Cette migration
-- pose les faits ; le barème n'est pas touché (aucune lecture de `ownerships`
-- dans lib/scoring — la possession n'est pas un achat).
--
-- Deux morceaux :
--   1. la table `ownerships` — la possession déclarée, et sa fin (don, revente) ;
--   2. la levée des contraintes qui interdisaient une lecture terminée SANS
--      date — le « déjà lu » dont on ne sait plus quand.
--
-- Comme partout : dates en `date` (jamais timestamptz — le bilan est mensuel,
-- §7), suppression douce (`deleted_at`, aucun DELETE), RLS activée.

-- ---------------------------------------------------------------------------
-- 1. ownerships — « je possède », indépendamment de l'achat
-- ---------------------------------------------------------------------------

create table ownerships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  book_id uuid not null references books (id),
  -- Depuis quand je le possède. NULLABLE, et c'est le cœur du ticket : les
  -- étagères d'avant n'ont pas de date d'acquisition connue. Renseignée, le
  -- livre entre dans la courbe de PAL et les flux du mois ; vide, il compte
  -- dans le STOCK sans polluer les FLUX (scanner 80 livres ne fait pas un pic).
  owned_since date,
  -- Renseignée = « je ne le possède plus » (don, revente, perte). Le livre sort
  -- de la pile et de la biblio possédée ; ses lectures et ses points restent au
  -- bilan — à ne pas confondre avec books.deleted_at (« Retirer »), qui masque
  -- le livre et TOUTES ses traces (§4.12).
  disposed_at date,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ownerships_disposed_after_owned check (
    disposed_at is null or owned_since is null or disposed_at >= owned_since
  )
);

-- UNE déclaration active par livre : la possession est un état, pas un
-- historique d'exemplaires. Partiel sur deleted_at is null pour que la
-- suppression douce laisse re-déclarer (résurrection, comme le rescan §4.12).
create unique index ownerships_active_book_idx
  on ownerships (user_id, book_id)
  where deleted_at is null;

create index ownerships_book_id_idx on ownerships (book_id);

alter table ownerships enable row level security;

create policy "ownerships_select_own" on ownerships
  for select to authenticated using ((select auth.uid()) = user_id);
-- Le with check vérifie aussi que le book_id référencé APPARTIENT à
-- l'utilisateur — même garde que readings/purchases : sans ça, un authentifié
-- connaissant un UUID d'autrui pourrait s'y accrocher.
create policy "ownerships_insert_own" on ownerships
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
create policy "ownerships_update_own" on ownerships
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
-- Pas de policy DELETE : suppression douce uniquement (§7).

-- ---------------------------------------------------------------------------
-- 2. « Déjà lu » — une lecture terminée dont on ne sait plus la date
-- ---------------------------------------------------------------------------
--
-- Les points sont datés par finished_at (§3, règle 1). Une lecture terminée
-- SANS date ne crédite donc aucun mois : c'est exactement le comportement
-- voulu pour l'étagère d'avant (« je l'ai lu, aucune idée de quand »), et la
-- raison pour laquelle ce geste ne peut pas gonfler le score. Une date PASSÉE
-- reste possible et crédite son mois — déjà clos, jamais le mois courant.

-- Interdisait `status = 'finished'` sans date : c'était la garantie que les
-- points avaient toujours un mois. Elle est remplacée par une règle plus juste
-- (pas de date → pas de points), portée par le moteur, pas par le schéma.
alter table readings drop constraint readings_finished_has_date;

-- Une lecture rétroactive n'a pas non plus de date de DÉBUT connue. Le moteur
-- de stats tolère déjà `startedAt` nul (les lectures qui traînent l'ignorent).
alter table readings alter column started_at drop not null;

-- Conséquence sur le journal d'états : le trigger date l'événement `finished`
-- avec finished_at, et l'événement de début avec started_at (migration
-- 20260719180000). Les deux peuvent désormais être nuls → occurred_at doit
-- pouvoir l'être aussi. « Date inconnue » plutôt qu'une date inventée : une
-- date fausse polluerait les comptages mensuels d'abandons et de reprises
-- (§4.5), et rien ne la distinguerait ensuite d'une vraie.
alter table reading_events alter column occurred_at drop not null;

-- Le trigger est réécrit À L'IDENTIQUE sauf ses commentaires : il s'appuyait
-- explicitement sur `readings_finished_has_date` pour affirmer que occurred_at
-- ne pouvait pas être nul. La contrainte n'existe plus — un commentaire qui
-- ment sur une garantie d'intégrité est pire que pas de commentaire.
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
        -- Terminée : la date de fin date les points (§3). NULLE pour un
        -- « déjà lu » sans date (#101) — l'événement existe, sa date est
        -- inconnue, et les comptages mensuels l'ignorent.
        when new.status = 'finished' then new.finished_at::timestamptz
        -- Vrai début (le premier événement de la lecture) : la date de début
        -- saisie, elle aussi nullable depuis #101 (lecture rétroactive).
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
