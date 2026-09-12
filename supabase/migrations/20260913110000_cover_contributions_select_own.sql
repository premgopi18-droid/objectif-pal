-- Pool partagé (#278) : le retrait doux échouait en 42501.
--
-- La policy SELECT ne montrait que les contributions VIVANTES ; or PostgreSQL
-- vérifie la ligne MISE À JOUR contre la policy SELECT (RETURNING implicite
-- de PostgREST) — poser deleted_at rendait la ligne invisible à son auteur,
-- donc l'UPDATE était refusé. Prouvé par le test d'isolation avant merge.
--
-- Règle : les vivantes pour tous (c'est le pool), les SIENNES toujours (pour
-- retirer, re-partager, exporter — l'export inclut les lignes soft-supprimées).

drop policy "cover_contributions_select_live" on cover_contributions;
create policy "cover_contributions_select_live_or_own" on cover_contributions
  for select to authenticated
  using (deleted_at is null or (select auth.uid()) = user_id);
