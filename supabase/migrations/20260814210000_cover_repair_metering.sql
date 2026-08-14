-- Métrage de la réparation de couvertures (issue #177, epic #182).
--
-- L'anti-boucle de la réparation (#53) vivait dans un Set mémoire côté
-- client : réinitialisé à chaque rechargement de page. Si un hôte de
-- couvertures tombe, chaque affichage de bibliothèque redéclenche jusqu'à
-- ~8 appels externes PAR VIGNETTE morte — scénario mesuré par l'audit du
-- 14/08/2026 à ~120 000 appels pour 100 utilisateurs.
--
-- La tentative se persiste désormais ICI : tamponnée AVANT de dérouler la
-- chaîne, relue avec un TTL (COVER_REPAIR_RETRY_DAYS, côté TS) — l'anti-boucle
-- survit au rechargement, à l'appareil, et à l'utilisateur. Le quota dédié
-- (kind 'cover_repair', 5/min) est déjà provisionné par la migration
-- 20260814100100 (#174).

alter table books add column cover_repair_attempted_at timestamptz;
