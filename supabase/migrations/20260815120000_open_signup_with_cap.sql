-- Ouverture plafonnée (décision du 15/08/2026, epic #182) — remplace le
-- modèle allowlist de #173.
--
-- Le plan initial visait un cercle CONNU (liste d'emails). Le vrai usage est
-- une AUDIENCE : l'URL sera annoncée à l'antenne — impossible de collecter
-- les Gmail des auditeurs un par un. La porte devient : premier arrivé,
-- premier servi, dans la limite du plafond. C'est le scénario exact pour
-- lequel la Phase 0/1 a durci l'app : quotas globaux, rate-limits, bornes
-- storage, cloisonnement prouvé — un compte inconnu ne peut plus rien casser
-- ni rien coûter au-delà de sa part.
--
-- `allowed_emails` RESTE, dormante : la suppression de compte (#205) la
-- nettoie toujours, et elle resservira telle quelle si la porte doit se
-- refermer (option « code d'invitation à l'antenne », gardée en réserve).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Plafond (~100, plan « Objectif 100 ») : le garde-fou d'infra gratuite —
  -- seuil au-delà duquel les jauges partagées (egress, quotas externes) ne
  -- sont plus dimensionnées. Se relève ici le jour où l'infra suit.
  -- Poreux à la course près (review #183) : à ~100 comptes, assumé.
  if (select count(*) from public.profiles) >= 100 then
    raise exception 'objectif-pal: plafond de comptes atteint';
  end if;

  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Triple filet : un display_name se trouve toujours.
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'lecteur')
  );
  return new;
end;
$$;
