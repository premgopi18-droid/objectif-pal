-- Rafraîchissement GCD en direct (#308, suivi de séries §4.17).
--
-- Le dump (3,76 Go, cookie de session exigé) ne se rafraîchit pas tout seul ;
-- l'API REST publique de comics.org, si. Chaque nuit, le job `series:gcd-live`
-- relit les séries GCD RELIÉES à une série du référentiel (en cours d'abord,
-- closes une fois par mois) et pose ici la date de relecture — la file de
-- nuit s'ordonne dessus. Vide après un rechargement du dump (staging par
-- CREATE TABLE LIKE, colonne non copiée) : tout se relit, c'est voulu.

alter table public.gcd_series add column live_checked_at timestamptz;
comment on column public.gcd_series.live_checked_at is 'Dernière relecture par l''API comics.org (#308) — NULL = jamais, ou dump rechargé depuis.';

-- La file du job : les séries en cours (ou sans fin connue) par ancienneté de relecture.
-- `is_current` NULL (inconnu) compte comme ouverte si `year_ended` est NULL — le prédicat
-- vaut alors NULL OR TRUE = TRUE, comme `isOpen` dans series-gcd-live-plan.mts.
create index gcd_series_live_checked_at_idx on public.gcd_series (live_checked_at) where is_current or year_ended is null;
