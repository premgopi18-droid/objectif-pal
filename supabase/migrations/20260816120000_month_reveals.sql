-- Le reveal appartient à l'émission (specs §4.14, issue #243).
--
-- §4.14 promettait « l'app ne spoile jamais le reveal » en croyant que le
-- reveal était la clôture du mois. Faux : le reveal, c'est l'ÉMISSION,
-- enregistrée plus tard dans le mois. Le dernier mois clos reste donc
-- verrouillé pour le cercle jusqu'au reveal MANUEL du propriétaire (bouton au
-- Bilan) — ou jusqu'à la bascule AUTOMATIQUE au 1er du mois suivant, un
-- PRÉDICAT DE TEMPS (aucun cron : le temps passe tout seul).
--
-- Le verrou est CÔTÉ SERVEUR, jamais côté UI (le patron des avis) : un mois
-- verrouillé est servi avec `report` à NULL (l'existence = le teasing, la
-- donnée = rien) et ses distinctions sont filtrées. Conséquence automatique :
-- la carte de paliste et le cumul annuel d'un ami excluent le mois verrouillé
-- (ils dérivent des lignes servies — servir le cumul plein permettrait de
-- déduire le score par soustraction).

-- ---------------------------------------------------------------------------
-- 1) monthly_reveals — l'état de reveal vit dans SA table, pas dans
--    monthly_reports (qui est un CACHE recalculé/purgé : un reveal ne doit
--    jamais disparaître dans un recalcul). SENS UNIQUE structurel : aucune
--    policy UPDATE ni DELETE — comme l'antenne, on ne dé-révèle pas.
-- ---------------------------------------------------------------------------

create table monthly_reveals (
  user_id uuid not null references profiles (id) on delete cascade,
  -- Le 1er du mois, comme monthly_reports/objectives/picks.
  month date not null check (month = date_trunc('month', month)),
  revealed_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table monthly_reveals enable row level security;

create policy "monthly_reveals_select_own" on monthly_reveals
  for select to authenticated using ((select auth.uid()) = user_id);

-- On ne révèle qu'un mois CLOS (le mois courant n'a même pas de ligne à
-- montrer) — frontière UTC, la convention de la synchro (#214).
create policy "monthly_reveals_insert_own_closed" on monthly_reveals
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and month < date_trunc('month', now())
  );

-- ---------------------------------------------------------------------------
-- 2) Le prédicat de visibilité — écrit UNE fois, réutilisé par les deux RPC.
--    Visible = révélé manuellement OU un mois entier s'est écoulé depuis la
--    clôture (juillet auto-visible le 1er septembre).
-- ---------------------------------------------------------------------------

create function is_month_revealed(owner_id uuid, report_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.monthly_reveals reveal
    where reveal.user_id = owner_id and reveal.month = report_month
  )
  or report_month < date_trunc('month', now()) - interval '1 month';
$$;

revoke all on function public.is_month_revealed(uuid, date) from public, anon;
grant execute on function public.is_month_revealed(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Les RPC du cercle apprennent le verrou. Le TYPE DE RETOUR de
--    get_circle_monthly_reports change (colonne `revealed`) → DROP puis
--    CREATE, `create or replace` refuserait.
-- ---------------------------------------------------------------------------

drop function get_circle_monthly_reports();

create function get_circle_monthly_reports()
returns table (user_id uuid, month date, report jsonb, computed_at timestamptz, revealed boolean)
language sql
security definer
set search_path = ''
as $$
  select
    r.user_id,
    r.month,
    -- Le verrou serveur : un mois non révélé est servi SANS sa donnée.
    case when visibility.revealed then r.report else null end as report,
    r.computed_at,
    visibility.revealed
  from public.monthly_reports r
  cross join lateral (
    select public.is_month_revealed(r.user_id, r.month) as revealed
  ) as visibility
  where r.user_id <> (select auth.uid())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_low = (select auth.uid()) and f.user_high = r.user_id)
          or (f.user_high = (select auth.uid()) and f.user_low = r.user_id))
    );
$$;

revoke all on function public.get_circle_monthly_reports() from public, anon;
grant execute on function public.get_circle_monthly_reports() to authenticated;

-- Les distinctions d'un mois verrouillé sont FILTRÉES (pas de teasing
-- nécessaire) — même signature, le remplacement suffit.
create or replace function get_circle_monthly_picks()
returns table (user_id uuid, month date, kind public.pick_kind, reading_id uuid)
language sql
security definer
set search_path = ''
as $$
  select p.user_id, p.month, p.kind, p.reading_id
  from public.monthly_picks p
  where p.user_id <> (select auth.uid())
    and p.month < date_trunc('month', now())
    and public.is_month_revealed(p.user_id, p.month)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_low = (select auth.uid()) and f.user_high = p.user_id)
          or (f.user_high = (select auth.uid()) and f.user_low = p.user_id))
    );
$$;
