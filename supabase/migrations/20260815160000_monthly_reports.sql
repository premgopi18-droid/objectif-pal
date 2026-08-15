-- Les agrégats des mois clos (epic #182, Phase 2 — le socle de §4.14 Amis).
--
-- Le score reste DÉRIVÉ (§4.7 : la base stocke des faits, le moteur TS
-- calcule) — ces lignes ne sont qu'un CACHE MATÉRIALISÉ des mois clos,
-- entretenu par la page Bilan quand les faits ont bougé, et re-calculable à
-- l'identique à tout moment. Tout reste modifiable rétroactivement : une
-- lecture retrouvée, une date corrigée → la version des faits bouge → les
-- mois concernés se recalculent à la prochaine visite du Bilan.
--
-- Pourquoi maintenant : §4.14 exige des « agrégats servis, jamais de RLS
-- élargie » — un ami lira CES lignes (via une fonction qui vérifie l'amitié),
-- jamais les lectures brutes : l'avis ne peut pas fuiter, même par bug.
-- Propriété du barème qui rend le mois clos stable : « une lecture terminée
-- un mois SUIVANT n'efface rien » (le malus ne regarde qu'en arrière) — seule
-- une édition RÉTROACTIVE peut changer un mois clos, d'où le versionnage.

-- Une ligne par mois clos : le rapport du moteur + les terminées du mois
-- (titres — candidates aux distinctions et matière du texte d'antenne).
create table monthly_reports (
  user_id uuid not null references profiles (id) on delete cascade,
  -- Le 1er du mois, comme monthly_objectives/monthly_picks.
  month date not null check (month = date_trunc('month', month)),
  report jsonb not null,
  -- La version des faits au moment du calcul — le comparateur de fraîcheur.
  fact_version bigint not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table monthly_reports enable row level security;

-- L'utilisateur lit et ENTRETIENT ses propres lignes (la page Bilan écrit via
-- le client session — la RLS garde). §4.14 lira les lignes d'un AMI via une
-- fonction security definer dédiée — ces policies-ci ne bougeront pas.
create policy "monthly_reports_select_own" on monthly_reports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "monthly_reports_insert_own" on monthly_reports
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "monthly_reports_update_own" on monthly_reports
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- DELETE permis (exception à « suppression douce partout », comme la config
-- d'objectifs #197) : c'est un CACHE — une ligne d'un mois redevenu vide se
-- retire, les faits sont ailleurs.
create policy "monthly_reports_delete_own" on monthly_reports
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- La version des faits — bumpée par TRIGGER sur tout ce qui entre au barème :
-- aucune action applicative à instrumenter, impossible d'oublier un chemin
-- (les 25 server actions d'aujourd'hui comme celles de demain).
-- ---------------------------------------------------------------------------

create table user_fact_versions (
  user_id uuid primary key references profiles (id) on delete cascade,
  version bigint not null default 1
);

alter table user_fact_versions enable row level security;

create policy "user_fact_versions_select_own" on user_fact_versions
  for select to authenticated using ((select auth.uid()) = user_id);
-- Aucune policy d'écriture : seul le trigger (security definer) écrit.

create function bump_fact_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  -- objective_targets ne porte pas de user_id : on remonte à l'objectif.
  if tg_table_name = 'objective_targets' then
    select user_id into owner from public.monthly_objectives
    where id = coalesce(new.objective_id, old.objective_id);
  else
    owner := coalesce(new.user_id, old.user_id);
  end if;
  -- Pendant une SUPPRESSION DE COMPTE (#205), la cascade a pu effacer le
  -- profil avant les lectures : versionner un fantôme violerait la FK et
  -- casserait la suppression RGPD — on laisse passer, il n'y a plus rien à
  -- garder frais.
  if owner is null or not exists (select 1 from public.profiles where id = owner) then
    return coalesce(new, old);
  end if;
  insert into public.user_fact_versions as versions (user_id, version)
  values (owner, 2) -- 2 : toute ligne stockée à la version 1 (l'état « jamais versionné ») devient périmée
  on conflict (user_id) do update set version = versions.version + 1;
  return coalesce(new, old);
end;
$$;

-- Tout ce qui peut changer un score passé : lectures (dates, statut, soft
-- delete), achats, LIVRES (la catégorie fait les points, le titre est dans
-- l'agrégat), objectifs et cibles (le bonus). Les distinctions (picks) sont
-- lues en direct par le Bilan — pas de version.
create trigger readings_bump_fact_version
  after insert or update or delete on readings
  for each row execute function bump_fact_version();
create trigger purchases_bump_fact_version
  after insert or update or delete on purchases
  for each row execute function bump_fact_version();
-- Ciblé par colonnes (review #214) : titre (dans l'agrégat), catégorie (les
-- points), deleted_at (l'élagage). Un changement de cover_url — le job de
-- rapatriement #208 en fait chaque nuit — ne périme rien.
create trigger books_bump_fact_version
  after insert or delete or update of title, category, deleted_at on books
  for each row execute function bump_fact_version();
create trigger monthly_objectives_bump_fact_version
  after insert or update or delete on monthly_objectives
  for each row execute function bump_fact_version();
create trigger objective_targets_bump_fact_version
  after insert or update or delete on objective_targets
  for each row execute function bump_fact_version();
