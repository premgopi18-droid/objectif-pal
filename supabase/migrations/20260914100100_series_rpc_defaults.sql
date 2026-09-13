-- Suivi de séries — lot A (#291), complément : des valeurs par défaut sur les
-- paramètres optionnels des RPC, pour que les types générés les rendent
-- optionnels côté TypeScript (`p_total_volumes?: number`) au lieu d'obliger
-- à envoyer un `null` typé `number`. Mêmes corps, mêmes signatures de types :
-- `create or replace` suffit.

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
        fact_declared_at = now()
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

create or replace function link_book_series(p_book_id uuid, p_series_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_name text;
  touched integer;
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if p_series_id is not null then
    select name into target_name from public.series where id = p_series_id;
    if not found then
      raise exception 'UX: Série introuvable';
    end if;
  end if;
  update public.books
    set series_id = p_series_id,
        series_name = coalesce(target_name, series_name)
    where id = p_book_id and user_id = caller and deleted_at is null;
  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'UX: Livre introuvable';
  end if;
end;
$$;
