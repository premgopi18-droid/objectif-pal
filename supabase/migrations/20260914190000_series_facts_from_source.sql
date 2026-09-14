-- Suivi de séries — AniList comme source de fait pour le manga (#304, suite de
-- #301, specs §4.17-4).
--
-- Aucune source ouverte ne décrit les parutions françaises ; pour le manga,
-- AniList décrit l'œuvre et une édition française normale compte autant de
-- tomes que l'originale (mesuré : 15 séries sur 20 reconnues en rapprochement
-- strict, 0 erreur). Priorité des sources : humain > AniList > GCD.
--
-- La RPC est GÉNÉRIQUE (« depuis une source ») : elle ne réécrit jamais un
-- fait humain, ne réécrit que ce qui change, et journalise (user_id NULL =
-- système). L'identifiant AniList vit sur series_external_ids (source
-- 'anilist') : après le premier rapprochement, on relit par id.

alter table series drop constraint series_fact_source_check;
alter table series add constraint series_fact_source_check
  check (fact_source in ('human', 'gcd', 'anilist'));

alter table series_external_ids drop constraint series_external_ids_source_check;
alter table series_external_ids add constraint series_external_ids_source_check
  check (source in ('bnf', 'gcd', 'anilist'));

-- La dernière tentative de rapprochement AniList par titre : une série non
-- reconnue n'est retentée qu'après une semaine (le job choisit par ancienneté).
alter table series add column anilist_searched_at timestamptz;
comment on column series.anilist_searched_at is
  'Dernière recherche AniList par titre (#304) — NULL = jamais ; une série non rapprochée est retentée après 7 jours.';

create function declare_series_fact_from_source(
  p_series_id uuid,
  p_source text,
  p_total_volumes integer default null,
  p_is_ongoing boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.series;
begin
  if p_source not in ('gcd', 'anilist') then
    raise exception 'objectif-pal: source de fait inconnue "%"', p_source;
  end if;
  if (p_total_volumes is null) = (not coalesce(p_is_ongoing, false)) then
    raise exception 'objectif-pal: un total OU une parution en cours';
  end if;
  if p_total_volumes is not null and (p_total_volumes < 1 or p_total_volumes > 5000) then
    return false;
  end if;

  select * into current from public.series where id = p_series_id for update;
  if not found then
    return false;
  end if;
  -- Un fait humain n'est jamais touché.
  if current.fact_declared_at is not null and current.fact_source = 'human' then
    return false;
  end if;
  -- Rien ne change : rien à écrire, rien à journaliser.
  if current.fact_declared_at is not null
     and current.fact_source = p_source
     and current.is_ongoing = coalesce(p_is_ongoing, false)
     and current.total_volumes is not distinct from p_total_volumes then
    return false;
  end if;

  update public.series
    set total_volumes = p_total_volumes,
        is_ongoing = coalesce(p_is_ongoing, false),
        fact_declared_by = null,
        fact_declared_at = now(),
        fact_source = p_source
    where id = p_series_id;
  insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
    values (p_series_id,
            case when p_total_volumes is null then 'declare_ongoing' else 'declare_total' end,
            p_total_volumes, coalesce(p_is_ongoing, false), null);
  return true;
end;
$$;
revoke all on function public.declare_series_fact_from_source(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.declare_series_fact_from_source(uuid, text, integer, boolean) to service_role;
