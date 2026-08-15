-- Les bilans comparés du cercle (specs §4.14, lot B — issue #229).
--
-- Le principe gravé depuis #214, appliqué à la lettre : « des agrégats
-- servis, jamais de RLS élargie ». Un ami lit les lignes `monthly_reports`
-- (le CACHE des mois clos) et les distinctions des mois clos via deux
-- fonctions `security definer` qui vérifient l'amitié ACCEPTÉE — jamais une
-- lecture brute : l'avis et la note ne peuvent pas fuiter, même par bug.
-- Aucune policy existante ne bouge.

-- ---------------------------------------------------------------------------
-- 1) Les mois clos de MES AMIS — la matière des bilans comparés.
--    Mes propres lignes se lisent en direct (RLS own) : la fonction ne sert
--    que les amis. Le mois courant n'a JAMAIS de ligne (§4.14, le reveal
--    reste à l'antenne) — il n'y a donc rien à filtrer ici : servir la table,
--    c'est servir des mois clos.
-- ---------------------------------------------------------------------------

create function get_circle_monthly_reports()
returns table (user_id uuid, month date, report jsonb, computed_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select r.user_id, r.month, r.report, r.computed_at
  from public.monthly_reports r
  where r.user_id <> (select auth.uid())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_low = (select auth.uid()) and f.user_high = r.user_id)
          or (f.user_high = (select auth.uid()) and f.user_low = r.user_id))
    );
$$;

revoke all on function public.get_circle_monthly_reports() from public, anon;
grant execute on function public.get_circle_monthly_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Les distinctions des mois CLOS de mes amis (§4.14 : « ce qu'un ami
--    voit » les inclut — tranche le point ouvert du lot C, option « servie »).
--    Le commentaire éditorial de la distinction reste local en v1 : on sert
--    le type et la lecture distinguée (le titre se résout côté client via les
--    `finishedReadings` de la ligne d'agrégat — aucune jointure sur les
--    lectures brutes). Les picks ne sont PAS versionnés (choix #214) : le
--    filtre « mois clos » se fait ici, en UTC — la même convention que la
--    synchro des agrégats (page Bilan), frontière de mois assumée sans enjeu.
-- ---------------------------------------------------------------------------

create function get_circle_monthly_picks()
returns table (user_id uuid, month date, kind public.pick_kind, reading_id uuid)
language sql
security definer
set search_path = ''
as $$
  select p.user_id, p.month, p.kind, p.reading_id
  from public.monthly_picks p
  where p.user_id <> (select auth.uid())
    and p.month < date_trunc('month', now())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_low = (select auth.uid()) and f.user_high = p.user_id)
          or (f.user_high = (select auth.uid()) and f.user_low = p.user_id))
    );
$$;

revoke all on function public.get_circle_monthly_picks() from public, anon;
grant execute on function public.get_circle_monthly_picks() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) La pastille sans aller-retour d'auth (suivi review #227) : le layout
--    comptait les demandes reçues après un `getUser()` réseau. Cette fonction
--    lit l'identité DANS le jeton (`auth.uid()`) — un seul aller-retour, et
--    sans session elle rend 0. `security invoker` : la RLS de `friendships`
--    fait autorité, la fonction ne fait que compter dedans.
-- ---------------------------------------------------------------------------

create function count_pending_friend_requests()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.friendships f
  where f.status = 'pending'
    and f.requester_id <> (select auth.uid())
    and (select auth.uid()) in (f.user_low, f.user_high);
$$;

revoke all on function public.count_pending_friend_requests() from public, anon;
grant execute on function public.count_pending_friend_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Suivi review #227 : un `prefix` NULL contournait la garde de longueur
--    (`char_length(NULL) < 2` vaut NULL, donc pas de retour anticipé) et
--    consommait un tick de quota pour rien — aucune fuite, le LIKE NULL ne
--    matchait rien. La garde devient honnête. Corps inchangé par ailleurs.
-- ---------------------------------------------------------------------------

create or replace function search_circle_profiles(prefix text)
returns table (id uuid, display_name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  needle text := lower(trim(prefix));
begin
  if caller is null then
    return;
  end if;
  -- La porte : il faut être entré au cercle pour chercher.
  if not exists (
    select 1 from public.profiles me
    where me.id = caller and me.circle_joined_at is not null
  ) then
    return;
  end if;
  if needle is null or char_length(needle) < 2 then
    return;
  end if;
  if not public.consume_action_quota('friend_search') then
    raise exception 'objectif-pal: quota de recherche atteint';
  end if;
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.display_name, p.avatar_url
    from public.profiles p
    where p.circle_joined_at is not null
      and p.id <> caller
      and lower(p.display_name) like needle || '%'
    order by lower(p.display_name)
    limit 10;
end;
$$;
