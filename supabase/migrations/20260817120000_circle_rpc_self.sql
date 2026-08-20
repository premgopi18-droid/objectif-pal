-- Le mode spectateur (#252) : voir SON profil comme le cercle le voit.
--
-- Ce que je vois de moi passe par la RLS (tout, y compris le mois non
-- révélé) ; ce que mes amis voient passe par les deux RPC du cercle et leur
-- verrou (#243). Le mode spectateur doit montrer LA VÉRITÉ SERVIE, jamais une
-- simulation client de `is_month_revealed` — une copie TypeScript de la règle
-- finirait par dériver, et un « aperçu honnête » qui peut mentir est raté.
--
-- Le prédicat s'élargit donc d'un cran : « amis acceptés OU soi-même ». Le
-- propriétaire reçoit exactement les lignes servies à ses amis — verrou
-- compris : son dernier mois clos non révélé lui arrive `report` NULL, comme
-- à tout le monde. Aucune donnée nouvelle n'est exposée (on ne s'ouvre que
-- soi, déjà lisible par RLS) ; la parité spectateur ≡ ami est prouvée par le
-- test d'isolation en CI.

create or replace function get_circle_monthly_reports()
returns table (user_id uuid, month date, report jsonb, computed_at timestamptz, revealed boolean)
language sql
security definer
set search_path = ''
as $$
  select
    r.user_id,
    r.month,
    -- Le verrou serveur (#243) : un mois non révélé est servi SANS sa donnée
    -- — y compris au propriétaire, c'est tout le sens du mode spectateur.
    case when visibility.revealed then r.report else null end as report,
    r.computed_at,
    visibility.revealed
  from public.monthly_reports r
  cross join lateral (
    select public.is_month_revealed(r.user_id, r.month) as revealed
  ) as visibility
  where r.user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_low = (select auth.uid()) and f.user_high = r.user_id)
          or (f.user_high = (select auth.uid()) and f.user_low = r.user_id))
    );
$$;

-- Même élargissement pour les distinctions : celles de mes mois verrouillés
-- me sont FILTRÉES en mode spectateur, comme pour un ami.
create or replace function get_circle_monthly_picks()
returns table (user_id uuid, month date, kind public.pick_kind, reading_id uuid)
language sql
security definer
set search_path = ''
as $$
  select p.user_id, p.month, p.kind, p.reading_id
  from public.monthly_picks p
  where p.month < date_trunc('month', now())
    and public.is_month_revealed(p.user_id, p.month)
    and (
      p.user_id = (select auth.uid())
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.user_low = (select auth.uid()) and f.user_high = p.user_id)
            or (f.user_high = (select auth.uid()) and f.user_low = p.user_id))
      )
    );
$$;
