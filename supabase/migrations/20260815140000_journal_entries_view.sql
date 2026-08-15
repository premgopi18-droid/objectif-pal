-- La vue du journal paginé (#32 lot C, epic #182).
--
-- La pagination rend l'ordre CONTRACTUEL : « Charger plus » doit prolonger
-- exactement l'ordre affiché, sinon les pages s'entremêlent. Or l'ordre du
-- journal (#146 — l'activité d'abord, le temps ensuite, le sans-date à la
-- fin) est un CASE, et PostgREST ne trie que des colonnes : la vue expose
-- donc les clés de tri calculées. Elle remplace la logique TS de
-- filter-journal-entries (sortJournalEntries/journalEntryMonth), retirée en
-- même temps — LA VUE FAIT FOI, pas de duplication (le vœu du module).
--
--   journal_rank  : 0 en cours · 1 terminée datée · 2 abandonnée · 3 terminée
--                   sans date (les lectures d'avant l'app, reléguées en bas)
--   journal_date  : la date qui ordonne DANS un groupe — la FIN d'une
--                   terminée (elle date les points), le DÉBUT sinon
--   journal_month : le mois du filtre (#34) — fin sinon début, 'YYYY-MM'
--
-- security_invoker : la vue lit avec les droits de l'APPELANT — la RLS de
-- readings et books s'applique comme partout (« tu ne lis que tes lignes »).
-- Les soft-supprimés (lecture OU livre) sont déjà élagués, même sémantique
-- que la page d'avant (#49 : un livre retiré emporte ses lectures).

create view journal_entries
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
  b.page_count
from readings r
join books b on b.id = r.book_id
where r.deleted_at is null
  and b.deleted_at is null;
