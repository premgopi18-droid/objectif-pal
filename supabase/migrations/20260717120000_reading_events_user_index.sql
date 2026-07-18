-- Index sur reading_events(user_id) — audit du 17/07/2026 (issue #20).
-- La policy SELECT (reading_events_select_own) filtre sur user_id à chaque
-- lecture, mais la table n'était indexée que sur reading_id : sous RLS, toute
-- requête déclenchait un seq scan pour retrouver les lignes de l'utilisateur.
-- Cet index aligne l'accès sur le prédicat réel de la policy.
create index reading_events_user_id_idx on reading_events (user_id);
