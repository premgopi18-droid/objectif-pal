-- Le filet de sécurité que la migration précédente avait retiré (review #103).
--
-- `20260720120000` a levé `readings_finished_has_date` pour rendre légal le
-- « déjà lu » sans date (#101). Effet de bord : plus RIEN au niveau base
-- n'empêchait une lecture normalement suivie dans l'app de perdre sa date de
-- fin — un bug qui ne planterait pas, mais ferait silencieusement disparaître
-- des points du bilan. C'est exactement la classe d'erreur que la contrainte
-- d'origine attrapait.
--
-- La règle affinée distingue les deux situations par ce que la lecture SAIT
-- d'elle-même : une lecture suivie dans l'app a forcément une date de début
-- (on l'a commencée ici) ; une lecture rétroactive n'en a pas. D'où :
--
--   une lecture TERMINÉE sans date de fin doit aussi être sans date de début.
--
-- Table de vérité (les quatre cas légitimes passent, le seul fautif casse) :
--
--   status     | started_at | finished_at | verdict
--   -----------+------------+-------------+---------------------------------
--   reading    | date       | null        | ✅ lecture en cours
--   finished   | date       | date        | ✅ lecture suivie dans l'app
--   finished   | null       | date        | ✅ « déjà lu », fin connue
--   finished   | null       | null        | ✅ « déjà lu », rien de connu
--   finished   | date       | null        | ❌ LE BUG : on a commencé la
--                                         |    lecture ici, et sa date de fin
--                                         |    a disparu → points perdus
--
-- Les gardes applicatives (`finishReading` valide la date, `updateReadingDetails`
-- refuse de la vider) restent en première ligne : celle-ci est le dernier
-- rempart, pas le seul.

alter table readings
  add constraint readings_undated_finish_has_no_start
  check (status <> 'finished' or finished_at is not null or started_at is null);
