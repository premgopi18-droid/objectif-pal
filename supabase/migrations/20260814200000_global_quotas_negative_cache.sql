-- Quotas globaux + cache négatif (issues #175 et #176, epic #182).
--
-- Deux protections de la même ressource : les quotas des fournisseurs externes
-- sont PARTAGÉS par toute l'app (Google Books 1 000 req/jour pour LA clé,
-- Metron 20 req/min pour LE compte) — le rate-limit par utilisateur (#32 lot A)
-- ne les protège pas, et un livre « difficile » relançait la chaîne complète à
-- chaque scan faute de cache négatif.

-- ---------------------------------------------------------------------------
-- #176 — la mémoire du « rien » sur barcode_cache et barcode_misses
-- ---------------------------------------------------------------------------

-- Quand la chaîne couverture a répondu PROPREMENT « rien » (aucune panne,
-- budget non épuisé), on le note : pas de re-tentative avant le TTL
-- (COVER_RECHECK_DAYS, côté TS). Nullable : les entrées existantes retentent
-- comme avant jusqu'à leur premier verdict propre.
alter table barcode_cache add column cover_checked_at timestamptz;

-- Le livre qu'AUCUNE base ne connaît — jusqu'ici jamais mémorisé : chaque
-- scan repartait en cascade complète (jusqu'à 7 appels externes), pour
-- toujours. Table séparée de barcode_cache : pas de fausse « résolution »,
-- pas de pollution de l'enum metadata_source. cover_url garde l'image
-- éventuellement trouvée chez les libraires (#55) pour pré-remplir la saisie
-- manuelle au rescan sans re-payer la chaîne. Croissance sans purge assumée
-- (quelques octets par code inconnu) — le futur job de maintenance (Phase 1)
-- pourra balayer `last_checked_at < now() - interval '90 days'`.
create table barcode_misses (
  barcode text primary key,
  cover_url text,
  last_checked_at timestamptz not null default now()
);

-- Serveur seul (service role) : aucune policy, comme lookup_rate_limits.
alter table barcode_misses enable row level security;

-- ---------------------------------------------------------------------------
-- #175 — les compteurs GLOBAUX (par application, pas par utilisateur)
-- ---------------------------------------------------------------------------

create table global_action_quotas (
  kind text primary key,
  window_started_at timestamptz not null,
  action_count integer not null check (action_count > 0)
);

alter table global_action_quotas enable row level security;

-- Même mécanique éprouvée que consume_action_quota (fenêtre fixe, upsert
-- atomique), sans user_id : UNE fenêtre pour toute l'app. Seuils codés ici
-- (#174) :
--   google_books_daily — 900/jour : 100 de marge sous le quota de la clé
--                        (réparations, scripts) ;
--   metron             — 15/min : sous les 20/min du compte, un appel HTTP
--                        consommé = un tick (liste ET détail comptent).
create function consume_global_quota(action_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_actions integer;
  window_seconds integer;
  current_count integer;
begin
  case action_kind
    when 'google_books_daily' then
      max_actions := 900;
      window_seconds := 86400;
    when 'metron' then
      max_actions := 15;
      window_seconds := 60;
    else
      raise exception 'objectif-pal: quota global inconnu "%"', action_kind;
  end case;

  insert into public.global_action_quotas as quotas (kind, window_started_at, action_count)
  values (action_kind, now(), 1)
  on conflict (kind) do update set
    action_count = case
      when now() - quotas.window_started_at >= make_interval(secs => window_seconds) then 1
      else quotas.action_count + 1
    end,
    window_started_at = case
      when now() - quotas.window_started_at >= make_interval(secs => window_seconds) then now()
      else quotas.window_started_at
    end
  returning quotas.action_count into current_count;

  return current_count <= max_actions;
end;
$$;

-- Appelée par le SEUL serveur (client admin) — même un authentifié n'a pas à
-- consommer le compteur commun.
revoke all on function public.consume_global_quota(text) from public, anon, authenticated;
grant execute on function public.consume_global_quota(text) to service_role;
