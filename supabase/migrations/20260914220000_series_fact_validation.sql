-- Les sources valident ou remplacent un fait humain (#317, décisions de Prem du
-- 14/09/2026, §4.17-3/4).
--
-- Jusqu'ici : humain > AniList > GCD, jamais par-dessus un fait humain. Donc
-- une valeur humaine fausse ou périmée restait à jamais, et personne ne savait
-- quand une source la confirmait. Désormais :
--  1. seules les valeurs DE FAIT (GCD série close / en cours, AniList terminée
--     / en cours) remplacent — jamais un plancher ;
--  2. un fait humain NON VERROUILLÉ différent est remplacé, journalisé
--     (`source_override`, valeur d'avant + source), et la dernière déclaration
--     humaine reste sur la série (`human_*`) pour le bouton « Garder N » ;
--  3. toute déclaration humaine faite par-dessus un fait de source VERROUILLE
--     (`fact_locked_at`) : plus aucune source ne repasse ;
--  4. un fait humain identique à la source est CONFIRMÉ (`fact_confirmed_*`),
--     la fiche le dit ; une nouvelle déclaration efface la confirmation.
-- AniList > GCD reste : un fait AniList n'est pas remplacé par GCD.

-- 1. Les colonnes.
alter table public.series
  add column human_total_volumes integer check (human_total_volumes between 1 and 5000),
  add column human_is_ongoing boolean,
  add column human_declared_by uuid references public.profiles (id) on delete set null,
  add column human_declared_at timestamptz,
  add column fact_locked_at timestamptz,
  add column fact_confirmed_by text check (fact_confirmed_by in ('gcd', 'anilist')),
  add column fact_confirmed_at timestamptz;
comment on column public.series.human_total_volumes is 'La dernière déclaration humaine (total), conservée même quand une source a remplacé le fait courant (#317).';
comment on column public.series.human_is_ongoing is 'La dernière déclaration humaine (parution en cours), conservée même quand une source a remplacé le fait courant (#317).';
comment on column public.series.fact_locked_at is 'Fait humain verrouillé : déclaré par-dessus une source, ou « Garder » — plus aucune source ne repasse (#317).';
comment on column public.series.fact_confirmed_by is 'Une source (gcd / anilist) dit la même chose que le fait humain courant (#317).';

update public.series
  set human_total_volumes = total_volumes,
      human_is_ongoing = is_ongoing,
      human_declared_by = fact_declared_by,
      human_declared_at = fact_declared_at
  where fact_source = 'human' and fact_declared_at is not null;

-- 2. L'historique : le remplacement par une source, avec la valeur d'avant.
alter table public.series_events drop constraint series_events_kind_check;
alter table public.series_events
  add constraint series_events_kind_check
  check (kind in ('declare_total', 'declare_ongoing', 'rename', 'merge', 'source_override'));
alter table public.series_events
  add column previous_total_volumes integer,
  add column previous_is_ongoing boolean,
  add column source text check (source in ('gcd', 'anilist'));
comment on column public.series_events.source is 'Pour `source_override` : la source qui a remplacé le fait humain (#317).';

-- 3. La déclaration humaine (même corps que 20260914170000 + human_*, verrou, confirmation).
create or replace function public.declare_series_fact(
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
  current public.series;
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

  select * into current from public.series where id = p_series_id for update;
  if not found then
    raise exception 'UX: Série introuvable';
  end if;

  update public.series
    set total_volumes = p_total_volumes,
        is_ongoing = coalesce(p_is_ongoing, false),
        fact_declared_by = caller,
        fact_declared_at = now(),
        fact_source = 'human',
        human_total_volumes = p_total_volumes,
        human_is_ongoing = coalesce(p_is_ongoing, false),
        human_declared_by = caller,
        human_declared_at = now(),
        -- Déclarer par-dessus un fait de source est un choix informé : verrouillé (règle 3).
        fact_locked_at = case
          when current.fact_declared_at is not null and current.fact_source <> 'human' then now()
          else current.fact_locked_at
        end,
        fact_confirmed_by = null,
        fact_confirmed_at = null
    where id = p_series_id;

  insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
    values (p_series_id,
            case when p_total_volumes is null then 'declare_ongoing' else 'declare_total' end,
            p_total_volumes, coalesce(p_is_ongoing, false), caller);
end;
$$;

-- 4. Le fait depuis une source — rend ce qui s'est passé :
--    'declared' (posé / mis à jour), 'overridden' (a remplacé un fait humain),
--    'confirmed' (dit la même chose que l'humain), 'unchanged' (rien).
drop function public.declare_series_fact_from_source(uuid, text, integer, boolean);
create function public.declare_series_fact_from_source(
  p_series_id uuid,
  p_source text,
  p_total_volumes integer default null,
  p_is_ongoing boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.series;
  ongoing boolean := coalesce(p_is_ongoing, false);
begin
  if p_source not in ('gcd', 'anilist') then
    raise exception 'objectif-pal: source de fait inconnue "%"', p_source;
  end if;
  if (p_total_volumes is null) = (not ongoing) then
    raise exception 'objectif-pal: un total OU une parution en cours';
  end if;
  if p_total_volumes is not null and (p_total_volumes < 1 or p_total_volumes > 5000) then
    return 'unchanged';
  end if;

  select * into current from public.series where id = p_series_id for update;
  if not found then
    return 'unchanged';
  end if;

  if current.fact_declared_at is not null and current.fact_source = 'human' then
    -- Verrouillé : l'humain a tranché en connaissance de cause.
    if current.fact_locked_at is not null then
      return 'unchanged';
    end if;
    -- La source dit la même chose : confirmé, rien à journaliser.
    if current.is_ongoing = ongoing and current.total_volumes is not distinct from p_total_volumes then
      if current.fact_confirmed_by is distinct from p_source then
        update public.series set fact_confirmed_by = p_source, fact_confirmed_at = now() where id = p_series_id;
      end if;
      return 'confirmed';
    end if;
    -- Différent : remplacé, journalisé avec la valeur d'avant ; human_* reste pour « Garder ».
    update public.series
      set total_volumes = p_total_volumes,
          is_ongoing = ongoing,
          fact_declared_by = null,
          fact_declared_at = now(),
          fact_source = p_source,
          fact_confirmed_by = null,
          fact_confirmed_at = null
      where id = p_series_id;
    insert into public.series_events (series_id, kind, total_volumes, is_ongoing, previous_total_volumes, previous_is_ongoing, source, user_id)
      values (p_series_id, 'source_override', p_total_volumes, ongoing, current.total_volumes, current.is_ongoing, p_source, null);
    return 'overridden';
  end if;

  -- AniList > GCD (#304) : un fait AniList n'est pas remplacé par GCD.
  if current.fact_declared_at is not null and current.fact_source = 'anilist' and p_source = 'gcd' then
    return 'unchanged';
  end if;
  -- Rien ne change : rien à écrire, rien à journaliser.
  if current.fact_declared_at is not null
     and current.fact_source = p_source
     and current.is_ongoing = ongoing
     and current.total_volumes is not distinct from p_total_volumes then
    return 'unchanged';
  end if;

  update public.series
    set total_volumes = p_total_volumes,
        is_ongoing = ongoing,
        fact_declared_by = null,
        fact_declared_at = now(),
        fact_source = p_source
    where id = p_series_id;
  insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
    values (p_series_id,
            case when p_total_volumes is null then 'declare_ongoing' else 'declare_total' end,
            p_total_volumes, ongoing, null);
  return 'declared';
end;
$$;
revoke all on function public.declare_series_fact_from_source(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.declare_series_fact_from_source(uuid, text, integer, boolean) to service_role;

-- 5. La synchronisation GCD délègue la règle à la RPC ci-dessus (une seule
--    règle) et inclut désormais les faits humains non verrouillés.
drop function public.sync_series_facts_from_gcd();
create function public.sync_series_facts_from_gcd()
returns table (declared_total integer, declared_ongoing integer, overridden integer, confirmed integer, unchanged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  totals integer := 0;
  ongoings integer := 0;
  overrides integer := 0;
  confirmations integer := 0;
  untouched integer := 0;
  candidate record;
  outcome text;
begin
  for candidate in
    select s.id,
           bool_or(g.is_current) as any_current,
           max(g.last_number) as last_number
    from public.series s
    join public.series_external_ids x on x.series_id = s.id and x.source = 'gcd' and x.external_id ~ '^\d+$'
    join public.gcd_series g on g.id = x.external_id::integer
    where s.fact_declared_at is null
       or s.fact_source = 'gcd'
       or (s.fact_source = 'human' and s.fact_locked_at is null)
    group by s.id
  loop
    if candidate.any_current then
      outcome := public.declare_series_fact_from_source(candidate.id, 'gcd', null, true);
      if outcome = 'declared' then ongoings := ongoings + 1; end if;
    elsif candidate.last_number is not null and candidate.last_number between 1 and 5000 then
      outcome := public.declare_series_fact_from_source(candidate.id, 'gcd', candidate.last_number, false);
      if outcome = 'declared' then totals := totals + 1; end if;
    else
      outcome := 'unchanged';
    end if;
    if outcome = 'overridden' then overrides := overrides + 1;
    elsif outcome = 'confirmed' then confirmations := confirmations + 1;
    elsif outcome = 'unchanged' then untouched := untouched + 1;
    end if;
  end loop;
  return query select totals, ongoings, overrides, confirmations, untouched;
end;
$$;
revoke all on function public.sync_series_facts_from_gcd() from public, anon, authenticated;
grant execute on function public.sync_series_facts_from_gcd() to service_role;

-- 6. La fusion transporte les nouvelles colonnes avec le fait conservé (même corps que 20260914180000).
create or replace function public.merge_series(keep_series_id uuid, merge_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  keep_series public.series;
  merged_series public.series;
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if keep_series_id = merge_series_id then
    raise exception 'UX: Une série ne se fusionne pas avec elle-même';
  end if;
  if not public.consume_action_quota('series_write') then
    raise exception 'UX: Trop de modifications d''un coup — attends une minute et réessaie';
  end if;

  select * into keep_series from public.series where id = keep_series_id for update;
  if not found then
    raise exception 'UX: Série conservée introuvable';
  end if;
  select * into merged_series from public.series where id = merge_series_id for update;
  if not found then
    raise exception 'UX: Série à fusionner introuvable';
  end if;

  if exists (select 1 from public.series_external_ids where series_id = keep_series_id and source = 'gcd')
     and exists (select 1 from public.series_external_ids where series_id = merge_series_id and source = 'gcd') then
    raise exception 'UX: Ces deux séries sont deux séries différentes chez GCD : pas une graphie, deux séries';
  end if;

  update public.books
    set series_id = keep_series_id, series_name = keep_series.name
    where series_id = merge_series_id;
  update public.series_external_ids set series_id = keep_series_id where series_id = merge_series_id;
  update public.series_events set series_id = keep_series_id where series_id = merge_series_id;

  if keep_series.fact_declared_at is null and merged_series.fact_declared_at is not null then
    update public.series
      set total_volumes = merged_series.total_volumes,
          is_ongoing = merged_series.is_ongoing,
          fact_declared_by = merged_series.fact_declared_by,
          fact_declared_at = merged_series.fact_declared_at,
          fact_source = merged_series.fact_source,
          human_total_volumes = merged_series.human_total_volumes,
          human_is_ongoing = merged_series.human_is_ongoing,
          human_declared_by = merged_series.human_declared_by,
          human_declared_at = merged_series.human_declared_at,
          fact_locked_at = merged_series.fact_locked_at,
          fact_confirmed_by = merged_series.fact_confirmed_by,
          fact_confirmed_at = merged_series.fact_confirmed_at
      where id = keep_series_id;
  end if;

  insert into public.series_events (series_id, kind, old_name, new_name, merged_series_id, user_id)
    values (keep_series_id, 'merge', merged_series.name, keep_series.name, merge_series_id, caller);
  delete from public.series where id = merge_series_id;
end;
$$;
