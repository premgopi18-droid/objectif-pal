-- Durcissement du pool partagé après l'audit de la feature (#274, 13/09/2026).
--
-- Quatre trous vus en relecture sécurité :
--  1. le CHECK sur cover_url était une SOUS-CHAÎNE (`position(... in cover_url) > 0`) :
--     n'importe quelle URL avec le chemin en query passait, devenait couverture par
--     défaut au scan pour les autres, et cassait la capture en rafale sur ce code
--     (la garde d'inbox la refuse) ; un code étranger dans le chemin passait aussi ;
--  2. la policy SELECT servait la table ENTIÈRE (user_id ↔ code ↔ dossier privé)
--     à tout authentifié, alors que l'app ne lit les autres que par la fonction ;
--  3. la fonction révélait le pseudo à tout membre du cercle, pas aux seuls AMIS
--     acceptés — « Léna possède ce livre » à des inconnus ;
--  4. les colonnes techniques (created_at) étaient insérables : un tri forcé.
-- Plus le quota du partage (copie Storage en service role, illimitée).

-- 1. Un CHECK ANCRÉ : notre bucket, le dossier commun, le code de la ligne, un uuid.
--    Les lignes qui ne le respectent pas (témoins de test) sont retirées avant.
delete from cover_contributions
where cover_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/covers/shared/[0-9]{8,18}/[0-9a-f-]{36}\.webp$'
   or barcode !~ '^[0-9]{8,18}$';

alter table cover_contributions drop constraint cover_contributions_cover_url_check;
alter table cover_contributions
  add constraint cover_contributions_barcode_shape check (barcode ~ '^[0-9]{8,18}$'),
  add constraint cover_contributions_cover_url_shape check (
    cover_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/covers/shared/[0-9]{8,18}/[0-9a-f-]{36}\.webp$'
    and position('/covers/shared/' || barcode || '/' in cover_url) > 0
  ),
  add constraint cover_contributions_source_bounded check (char_length(source_cover_url) <= 1000);

-- 2. La table ne se lit que pour SOI ; les autres passent par la fonction.
drop policy "cover_contributions_select_live_or_own" on cover_contributions;
create policy "cover_contributions_select_own" on cover_contributions
  for select to authenticated using ((select auth.uid()) = user_id);

-- 4. Colonnes techniques hors de portée du client (patron friendships).
revoke insert, update on cover_contributions from authenticated;
grant insert (user_id, barcode, cover_url, source_cover_url, deleted_at) on cover_contributions to authenticated;
-- L'upsert de PostgREST (ON CONFLICT DO UPDATE) réécrit TOUTES les colonnes envoyées, clé
-- comprise : user_id et barcode restent updatables (la RLS garde la propriété), seules
-- id et created_at sont hors de portée.
grant update (user_id, barcode, cover_url, source_cover_url, deleted_at) on cover_contributions to authenticated;

-- 3. Le pseudo seulement entre AMIS acceptés (même critère que les bilans du cercle).
create or replace function get_cover_contributions(target_barcode text)
returns table (cover_url text, contributor_label text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select c.cover_url,
         case when exists (
           select 1 from public.friendships f
           where f.status = 'accepted'
             and ((f.user_low = (select auth.uid()) and f.user_high = c.user_id)
               or (f.user_high = (select auth.uid()) and f.user_low = c.user_id))
         ) then p.display_name else null end as contributor_label,
         c.created_at
  from public.cover_contributions c
  join public.profiles p on p.id = c.user_id
  where c.barcode = target_barcode
    and c.deleted_at is null
    and c.user_id <> (select auth.uid())
  order by c.created_at desc
  limit 10;
$$;

-- 5. Le partage est métré (copie Storage en service role) : 5/min, comme la réparation.
alter table lookup_rate_limits drop constraint lookup_rate_limits_kind_check;
alter table lookup_rate_limits add constraint lookup_rate_limits_kind_check
  check (kind in ('lookup', 'cover_repair', 'friend_search', 'friend_request', 'cover_candidates', 'cover_share'));

create or replace function consume_action_quota(action_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_actions integer;
  window_seconds integer;
  current_count integer;
begin
  if caller is null then
    return false;
  end if;

  -- Les seuils vivent ICI et nulle part ailleurs (durcissement #174) — voir
  -- 20260912200000 pour le détail de chaque kind ; cover_share : 5/min, une
  -- copie Storage par appel, on ne re-partage pas plus vite que ça à la main.
  case action_kind
    when 'lookup' then
      max_actions := 60;
      window_seconds := 60;
    when 'cover_repair' then
      max_actions := 5;
      window_seconds := 60;
    when 'friend_search' then
      max_actions := 30;
      window_seconds := 60;
    when 'friend_request' then
      max_actions := 10;
      window_seconds := 60;
    when 'cover_candidates' then
      max_actions := 10;
      window_seconds := 60;
    when 'cover_share' then
      max_actions := 5;
      window_seconds := 60;
    else
      raise exception 'objectif-pal: quota inconnu "%"', action_kind;
  end case;

  insert into public.lookup_rate_limits as limits (user_id, kind, window_started_at, lookup_count)
  values (caller, action_kind, now(), 1)
  on conflict (user_id, kind) do update set
    lookup_count = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then 1
      else limits.lookup_count + 1
    end,
    window_started_at = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then now()
      else limits.window_started_at
    end
  returning limits.lookup_count into current_count;

  return current_count <= max_actions;
end;
$$;
