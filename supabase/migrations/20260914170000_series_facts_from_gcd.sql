-- Suivi de séries — le fait de série depuis GCD (décision de Prem du 14/09/2026,
-- suite de #299, specs §4.17-4 amendée).
--
-- Un plancher n'est pas un total : après la remise à zéro, 101 séries de Prem
-- disaient « Total à déclarer » alors que GCD SAIT, pour 77 d'entre elles, si la
-- série est close (`is_current`) et quel est son dernier numéro (`last_issue_id`
-- → `number`). On importe ces champs et on déclare le fait À LA PLACE de
-- l'utilisateur, en le disant : `fact_source = 'gcd'`, auteur « GCD »,
-- modifiable d'un tap comme toute déclaration. Une déclaration HUMAINE n'est
-- jamais touchée par la synchronisation ; une déclaration GCD suit GCD.

-- 1. Les champs de série du dump (posés par gcd-export.mjs / gcd-load.mjs ;
--    le staging est créé « like gcd_series including all », il les hérite).
alter table gcd_series
  add column is_current boolean,
  add column year_ended integer,
  add column issue_count integer,
  -- Le numéro du DERNIER fascicule (`last_issue_id` du dump → son `number`,
  -- s'il est purement numérique) : le total d'une série close.
  add column last_number integer;
comment on column gcd_series.is_current is 'GCD : la série est toujours en cours de publication.';
comment on column gcd_series.last_number is 'GCD : le numéro du dernier fascicule (last_issue_id), s''il est numérique — le total d''une série close.';

-- 2. Qui a déclaré le fait : un humain, ou GCD.
alter table series
  add column fact_source text not null default 'human' check (fact_source in ('human', 'gcd'));
comment on column series.fact_source is
  'human = déclaré par un membre (§4.17-3) ; gcd = posé par la synchronisation depuis gcd_series (jamais par-dessus une déclaration humaine).';

-- 3. La déclaration humaine marque sa source (même corps que 20260914100100 + fact_source).
create or replace function declare_series_fact(
  p_series_id uuid,
  p_total_volumes integer default null,
  p_is_ongoing boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if not public.consume_action_quota('series_write') then
    raise exception 'UX: Trop de modifications d''un coup — attends une minute et réessaie';
  end if;
  if (p_total_volumes is null) = (not coalesce(p_is_ongoing, false)) then
    raise exception 'UX: Un total OU une parution en cours, pas les deux';
  end if;
  if p_total_volumes is not null and (p_total_volumes < 1 or p_total_volumes > 5000) then
    raise exception 'UX: Le total doit être entre 1 et 5000';
  end if;

  update public.series
    set total_volumes = p_total_volumes,
        is_ongoing = coalesce(p_is_ongoing, false),
        fact_declared_by = caller,
        fact_declared_at = now(),
        fact_source = 'human'
    where id = p_series_id;
  if not found then
    raise exception 'UX: Série introuvable';
  end if;

  insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
    values (p_series_id,
            case when p_total_volumes is null then 'declare_ongoing' else 'declare_total' end,
            p_total_volumes, coalesce(p_is_ongoing, false), caller);
end;
$$;

-- 4. La synchronisation : pour chaque série reliée à GCD SANS déclaration
--    humaine, le fait suit GCD — « en cours » si l'une de ses séries GCD est
--    courante, sinon le plus grand dernier numéro connu. Journalisée (user_id
--    NULL = système). Service role seulement (le job de nuit).
create function sync_series_facts_from_gcd()
returns table (declared_total integer, declared_ongoing integer, unchanged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  totals integer := 0;
  ongoings integer := 0;
  untouched integer := 0;
  candidate record;
begin
  for candidate in
    select s.id,
           s.total_volumes,
           s.is_ongoing,
           s.fact_source,
           s.fact_declared_at,
           bool_or(g.is_current) as any_current,
           max(g.last_number) as last_number
    from public.series s
    join public.series_external_ids x on x.series_id = s.id and x.source = 'gcd'
    join public.gcd_series g on g.id = x.external_id::integer
    where s.fact_declared_at is null or s.fact_source = 'gcd'
    group by s.id
  loop
    if candidate.any_current then
      if candidate.fact_declared_at is not null and candidate.is_ongoing then
        untouched := untouched + 1;
        continue;
      end if;
      update public.series
        set total_volumes = null, is_ongoing = true, fact_declared_by = null, fact_declared_at = now(), fact_source = 'gcd'
        where id = candidate.id;
      insert into public.series_events (series_id, kind, is_ongoing, user_id)
        values (candidate.id, 'declare_ongoing', true, null);
      ongoings := ongoings + 1;
    elsif candidate.last_number is not null and candidate.last_number between 1 and 5000 then
      if candidate.fact_declared_at is not null and candidate.total_volumes = candidate.last_number then
        untouched := untouched + 1;
        continue;
      end if;
      update public.series
        set total_volumes = candidate.last_number, is_ongoing = false, fact_declared_by = null, fact_declared_at = now(), fact_source = 'gcd'
        where id = candidate.id;
      insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
        values (candidate.id, 'declare_total', candidate.last_number, false, null);
      totals := totals + 1;
    else
      untouched := untouched + 1;
    end if;
  end loop;
  return query select totals, ongoings, untouched;
end;
$$;
revoke all on function public.sync_series_facts_from_gcd() from public, anon, authenticated;
grant execute on function public.sync_series_facts_from_gcd() to service_role;
