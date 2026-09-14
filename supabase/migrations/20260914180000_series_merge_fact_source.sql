-- Suivi de séries — handle de la review de #301.
--
-- 1. `merge_series` recopiait total / en cours / auteur / date de l'absorbée
--    mais pas `fact_source` : un fait posé par GCD passait pour humain après
--    fusion (la synchro ne le gérait plus, la fiche disait « un membre »).
--    Même corps que 20260914100000 + la ligne `fact_source`.
-- 2. `sync_series_facts_from_gcd` castait `external_id::integer` sans garde :
--    un identifiant non numérique (impossible aujourd'hui, mais la colonne
--    est du texte) aurait fait échouer toute la synchro. Garde regex.

create or replace function merge_series(keep_series_id uuid, merge_series_id uuid)
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
          fact_source = merged_series.fact_source
      where id = keep_series_id;
  end if;

  insert into public.series_events (series_id, kind, old_name, new_name, merged_series_id, user_id)
    values (keep_series_id, 'merge', merged_series.name, keep_series.name, merge_series_id, caller);
  delete from public.series where id = merge_series_id;
end;
$$;

create or replace function sync_series_facts_from_gcd()
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
    join public.series_external_ids x on x.series_id = s.id and x.source = 'gcd' and x.external_id ~ '^\d+$'
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
