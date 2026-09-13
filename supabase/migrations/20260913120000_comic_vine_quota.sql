-- Comic Vine (#279, lot C) : quota GLOBAL horaire — leurs conditions donnent
-- 200 requêtes par ressource et par heure ; 150/h chez nous (marge). Deux
-- appels par recherche (volume, issue), un tick chacun. Patron #175 : le
-- seuil vit ICI. Le reste de la fonction est repris tel quel de
-- 20260814200000_global_quotas_negative_cache.sql.

create or replace function consume_global_quota(action_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_actions integer;
  window_seconds integer;
  current_count integer;
begin
  case action_kind
    when 'google_books_daily' then
      max_actions := 900;
      window_seconds := 86400;
    when 'metron' then
      max_actions := 15;
      window_seconds := 60;
    when 'comic_vine_hourly' then
      max_actions := 150;
      window_seconds := 3600;
    else
      raise exception 'objectif-pal: quota global inconnu "%"', action_kind;
  end case;

  insert into public.global_action_quotas as quotas (kind, window_started_at, action_count)
  values (action_kind, now(), 1)
  on conflict (kind) do update set
    action_count = case
      when now() - quotas.window_started_at >= make_interval(secs => window_seconds) then 1
      else quotas.action_count + 1
    end,
    window_started_at = case
      when now() - quotas.window_started_at >= make_interval(secs => window_seconds) then now()
      else quotas.window_started_at
    end
  returning quotas.action_count into current_count;

  return current_count <= max_actions;
end;
$$;
