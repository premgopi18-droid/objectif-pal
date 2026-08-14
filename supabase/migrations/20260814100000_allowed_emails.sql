-- Allowlist d'inscription + plafond de comptes (issue #173, epic #182).
-- L'ouverture à 30-40 utilisateurs (plafond ~100) exige une porte d'entrée :
-- jusqu'ici, n'importe quel compte Google pouvait s'inscrire. La garde vit
-- dans le trigger d'inscription lui-même — un `raise exception` y annule
-- l'inscription entière (comportement documenté du trigger initial), c'est
-- exactement la propriété recherchée.

create table allowed_emails (
  -- L'email est stocké en minuscules — la garde compare en minuscules.
  email text primary key check (email = lower(email)),
  note text,
  added_at timestamptz not null default now()
);

-- RLS activée SANS policy : la liste ne se lit ni ne s'écrit depuis un client.
-- Elle se gère en SQL (dashboard/scripts) — un écran d'admin viendra si besoin.
alter table allowed_emails enable row level security;

-- Les comptes déjà inscrits sont invités d'office (aucun email en dur ici).
insert into allowed_emails (email, note)
select lower(email), 'compte existant au 14/08/2026'
from auth.users
where email is not null
on conflict (email) do nothing;

-- Le trigger d'inscription, avec la porte et le plafond.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Porte d'entrée (#173) : inscription sur invitation uniquement. L'exception
  -- annule l'inscription entière — côté client, l'échange OAuth échoue et
  -- /login explique.
  if new.email is null
     or not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'objectif-pal: inscription sur invitation uniquement';
  end if;

  -- Plafond de comptes (~100, plan « Objectif 100 ») : garde-fou d'infra
  -- gratuite, pas une règle produit — se relève ici le jour où l'infra suit.
  -- Assumé poreux (review #183) : deux inscriptions simultanées à 99 peuvent
  -- donner 101 (un pg_advisory_xact_lock l'étancherait), et le refus arrive
  -- au client sous le même « Database error » que « pas invité » — à ~100
  -- comptes près, aucun des deux ne vaut plus de code.
  if (select count(*) from public.profiles) >= 100 then
    raise exception 'objectif-pal: plafond de comptes atteint';
  end if;

  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Triple filet : un display_name se trouve toujours, l'inscription validée
    -- ne doit plus pouvoir échouer ici.
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'lecteur')
  );
  return new;
end;
$$;
