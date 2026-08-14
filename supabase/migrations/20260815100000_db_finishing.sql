-- Finitions base (issue #197, epic #182 — Phase 1).
--
-- 1. Les trois index relevés par l'audit du 14/08/2026 : à 100 utilisateurs,
--    un seq scan sur une table multi-tenant grossit avec le nombre de comptes,
--    pas avec le compte qui interroge.

-- L'export (#178) et les éléments completed lisent scan_inbox HORS du
-- prédicat des index partiels `where pending` existants.
create index scan_inbox_user_idx on scan_inbox (user_id);

-- Les stats (#178) lisent tout le journal d'états trié par id — table
-- append-only, 2-3 lignes par lecture, croissance illimitée. Le composite
-- REMPLACE l'index simple (user_id) posé en #27 : il couvre les mêmes
-- prédicats (préfixe) et sert en plus l'ORDER BY — garder les deux ne
-- paierait que des écritures.
drop index reading_events_user_id_idx;
create index reading_events_user_ordered_idx on reading_events (user_id, id);

-- La FK monthly_picks.reading_id n'était pas indexée : chaque vérification
-- d'intégrité côté readings la parcourait en séquentiel.
create index monthly_picks_reading_idx on monthly_picks (reading_id);

-- 2. monthly_picks : le FOR ALL autorisait un DELETE dur qu'aucun code
--    n'exécute — contradiction avec « suppression douce partout » (specs §7).
--    Scindé en trois policies identiques au périmètre près, SANS delete.
--    ⚠️ Les DELETE de monthly_objectives / objective_targets restent :
--    lib/goals/actions.ts remplace la CONFIGURATION d'objectif en entier
--    (delete + insert) — la règle §7 protège l'historique de lecture, pas la
--    configuration rejouable. Exception assumée, documentée ici.

drop policy "monthly_picks_all_own" on monthly_picks;

create policy "monthly_picks_select_own" on monthly_picks
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "monthly_picks_insert_own" on monthly_picks
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from readings r where r.id = reading_id and r.user_id = (select auth.uid()))
  );

create policy "monthly_picks_update_own" on monthly_picks
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from readings r where r.id = reading_id and r.user_id = (select auth.uid()))
  );
