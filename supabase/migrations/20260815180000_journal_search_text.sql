-- La recherche du Journal (issue #222) — colonne search_text sur la vue.
--
-- Le Journal est paginé (#32 lot C) : la recherche DOIT être côté requête
-- (une recherche client ne fouillerait que la tranche chargée, en silence).
-- La vue expose donc le texte cherchable NORMALISÉ — minuscules + sans
-- accents ni ligatures — et le client normalise son aiguille par la MÊME
-- règle (lib/search/entry-search.ts : la parité est LE contrat, testée côté
-- TS sur les cas qui divergent — œ/æ que NFD ne décompose pas).
--
-- unaccent en forme À DEUX ARGUMENTS (dictionnaire qualifié) : la forme à un
-- argument résout son dictionnaire via search_path — fragile sous
-- security_invoker où le search_path est celui de l'appelant.

create extension if not exists unaccent with schema extensions;

create or replace view journal_entries
with (security_invoker = true) as
select
  r.id,
  r.user_id,
  r.status,
  r.started_at,
  r.finished_at,
  r.rating,
  r.comment,
  r.created_at,
  case
    when r.status = 'reading' then 0
    when r.status = 'finished' and r.finished_at is not null then 1
    when r.status = 'abandoned' then 2
    else 3
  end as journal_rank,
  case when r.status = 'finished' then r.finished_at else r.started_at end as journal_date,
  to_char(coalesce(r.finished_at, r.started_at), 'YYYY-MM') as journal_month,
  b.id as book_id,
  b.title,
  b.series_name,
  b.issue_number,
  b.category,
  b.cover_url,
  b.page_count,
  -- Le texte cherchable (#222) — titre + série, normalisés comme l'aiguille.
  extensions.unaccent('extensions.unaccent'::regdictionary, lower(b.title || ' ' || coalesce(b.series_name, ''))) as search_text
from readings r
join books b on b.id = r.book_id
where r.deleted_at is null
  and b.deleted_at is null;
