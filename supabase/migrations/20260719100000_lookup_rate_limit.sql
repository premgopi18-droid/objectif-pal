-- Rate-limiting de /api/lookup (issue #32, lot A) — compteur à fenêtre fixe
-- par utilisateur, en base : il survit aux cold starts Vercel, contrairement
-- à un compteur mémoire. Protège les quotas externes PARTAGÉS (Google Books
-- 1 000 req/jour, Metron) et borne la croissance de barcode_cache.

create table lookup_rate_limits (
  user_id uuid primary key references profiles (id) on delete cascade,
  window_started_at timestamptz not null,
  lookup_count integer not null check (lookup_count > 0)
);

-- RLS activée SANS policy : la table n'est accessible qu'à travers la
-- fonction (security definer) — un client ne peut ni lire ni trafiquer son
-- compteur.
alter table lookup_rate_limits enable row level security;

-- Consomme une unité de quota pour l'appelant et dit si l'appel est permis.
-- Les seuils viennent de l'APPELANT : la constante vit dans le code
-- (lib/resolution/lookup-rate-limit.ts), jamais recopiée en SQL.
-- L'upsert est atomique : deux lookups simultanés ne perdent pas de tick.
create function consume_lookup_quota(max_lookups integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_count integer;
begin
  -- Pas de session : rien à consommer, et rien à permettre.
  if caller is null then
    return false;
  end if;

  -- Dans le DO UPDATE, `limits.*` désigne la ligne EXISTANTE (avant update) :
  -- fenêtre expirée → on repart à 1, sinon on incrémente.
  insert into public.lookup_rate_limits as limits (user_id, window_started_at, lookup_count)
  values (caller, now(), 1)
  on conflict (user_id) do update set
    lookup_count = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then 1
      else limits.lookup_count + 1
    end,
    window_started_at = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then now()
      else limits.window_started_at
    end
  returning limits.lookup_count into current_count;

  return current_count <= max_lookups;
end;
$$;
