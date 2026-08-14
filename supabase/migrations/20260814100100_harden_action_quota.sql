-- Durcissement du rate-limit (issue #174, epic #182).
--
-- L'ancienne `consume_lookup_quota(max_lookups, window_seconds)` prenait ses
-- seuils DE L'APPELANT et n'avait ni revoke ni grant : tout authentifié
-- pouvait l'appeler en direct via rpc() avec des seuils à lui — et la branche
-- « fenêtre expirée » remettait compteur et fenêtre à zéro à volonté. Le quota
-- qu'elle protège (Google Books 1 000 req/jour) étant PARTAGÉ, un seul compte
-- pouvait griller le scan de tous les autres.
--
-- La remplaçante `consume_action_quota(action_kind)` :
--   - code ses seuils ICI (l'appelant ne choisit plus que le type d'action) ;
--   - est révoquée de public/anon (patron de `merge_books`) ;
--   - porte un `kind` par compteur — le quota dédié de la réparation de
--     couvertures (#177) utilise la même mécanique sans nouvelle table.
--
-- Déploiement : entre l'application de cette migration et le déploiement du
-- code qui appelle la nouvelle fonction, l'ancien code échoue en FAIL-OPEN
-- (les scans passent, non comptés, avec un log) — fenêtre courte et assumée.

alter table lookup_rate_limits
  add column kind text not null default 'lookup'
  check (kind in ('lookup', 'cover_repair'));

alter table lookup_rate_limits drop constraint lookup_rate_limits_pkey;
alter table lookup_rate_limits add primary key (user_id, kind);

drop function consume_lookup_quota(integer, integer);

create function consume_action_quota(action_kind text)
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
  -- Pas de session : rien à consommer, et rien à permettre.
  if caller is null then
    return false;
  end if;

  -- Les seuils vivent ICI et nulle part ailleurs (durcissement #174) :
  --   lookup       — 60/min : physiquement inatteignable au scanner (#126),
  --                  ne freine que les boucles ;
  --   cover_repair — 5/min : la réparation d'une couverture morte est rare
  --                  par nature, une salve est toujours un emballement (#177).
  case action_kind
    when 'lookup' then
      max_actions := 60;
      window_seconds := 60;
    when 'cover_repair' then
      max_actions := 5;
      window_seconds := 60;
    else
      raise exception 'objectif-pal: quota inconnu "%"', action_kind;
  end case;

  -- Dans le DO UPDATE, `limits.*` désigne la ligne EXISTANTE (avant update) :
  -- fenêtre expirée → on repart à 1, sinon on incrémente. Upsert atomique —
  -- deux appels simultanés ne perdent pas de tick.
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

revoke all on function public.consume_action_quota(text) from public, anon;
grant execute on function public.consume_action_quota(text) to authenticated;
