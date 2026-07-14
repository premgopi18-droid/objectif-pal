-- Intégrité du journal de lecture — audit du 14/07/2026 (issue #20).
-- La base cesse de faire confiance à la discipline du code applicatif :
--   - reading_events ne s'écrit plus que par le trigger (append_reading_event) ;
--   - une seule lecture en cours par livre et par utilisateur ;
--   - les dates d'une lecture sont cohérentes (fin ≥ début, fin ⇔ terminée).
-- Le code applicatif valide en amont avec des messages français clairs
-- (lib/books/journal-actions.ts) : ces contraintes sont le filet, pas l'UI.

-- ---------------------------------------------------------------------------
-- reading_events — plus AUCUNE écriture depuis le client
-- ---------------------------------------------------------------------------

-- Le trigger append_reading_event (SECURITY DEFINER, migration du 14/07)
-- journalise déjà chaque transition, atomiquement. La policy INSERT client
-- n'était qu'un reliquat d'avant le trigger : un client pouvait injecter des
-- événements arbitraires dans un journal append-only, impossibles à nettoyer.
drop policy "reading_events_insert_own" on reading_events;

-- ---------------------------------------------------------------------------
-- readings — les invariants du journal
-- ---------------------------------------------------------------------------

-- Une seule lecture EN COURS d'un même livre à la fois : deux « en cours »
-- simultanées ne correspondent à aucun geste réel et fausseraient le rythme.
-- Index partiel : les lectures terminées/abandonnées (les relectures) et les
-- supprimées en douceur ne comptent pas.
create unique index readings_one_in_progress_per_book_idx
  on readings (user_id, book_id)
  where status = 'reading' and deleted_at is null;

-- Une lecture ne se termine pas avant d'avoir commencé.
alter table readings
  add constraint readings_finished_after_started
  check (finished_at is null or finished_at >= started_at);

-- Seule une lecture TERMINÉE porte une date de fin : c'est elle qui date les
-- points (§3) — une date de fin orpheline sur une lecture en cours ou
-- abandonnée créditerait des points fantômes au bilan.
-- (Complète readings_finished_has_date, qui vérifie le sens inverse.)
alter table readings
  add constraint readings_only_finished_has_date
  check (status = 'finished' or finished_at is null);
