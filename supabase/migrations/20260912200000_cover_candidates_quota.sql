-- Le sélecteur de couvertures (#276, epic #274) : ouvrir la feuille interroge
-- jusqu'à six sources en parallèle, dont Google Books (900 appels par jour
-- pour tout le monde). Nouveau kind `cover_candidates`, 10/min par
-- utilisateur — assez pour tester plusieurs livres d'affilée, assez bas pour
-- qu'une salve reste un emballement. Patron #174 : le seuil vit ICI.
--
-- Le reste de la fonction est repris tel quel de
-- 20260815220000_circle_friendships.sql (section 4).

alter table lookup_rate_limits drop constraint lookup_rate_limits_kind_check;
alter table lookup_rate_limits add constraint lookup_rate_limits_kind_check
  check (kind in ('lookup', 'cover_repair', 'friend_search', 'friend_request', 'cover_candidates'));

create or replace function consume_action_quota(action_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_actions integer;
  window_seconds integer;
  current_count integer;
begin
  -- Pas de session : rien à consommer, et rien à permettre.
  if caller is null then
    return false;
  end if;

  -- Les seuils vivent ICI et nulle part ailleurs (durcissement #174) :
  --   lookup           — 60/min : physiquement inatteignable au scanner (#126),
  --                      ne freine que les boucles ;
  --   cover_repair     — 5/min : la réparation d'une couverture morte est rare
  --                      par nature, une salve est toujours un emballement (#177) ;
  --   friend_search    — 30/min : la frappe débouncée d'un humain qui cherche
  --                      un pseudo, jamais une moisson d'annuaire (§4.14) ;
  --   friend_request   — 10/min : on n'invite pas plus vite que ça à la main —
  --                      borne l'acharnement comme le spam (§4.14) ;
  --   cover_candidates — 10/min : une ouverture de feuille = jusqu'à six
  --                      sources ; on change de couverture rarement (#276).
  case action_kind
    when 'lookup' then
      max_actions := 60;
      window_seconds := 60;
    when 'cover_repair' then
      max_actions := 5;
      window_seconds := 60;
    when 'friend_search' then
      max_actions := 30;
      window_seconds := 60;
    when 'friend_request' then
      max_actions := 10;
      window_seconds := 60;
    when 'cover_candidates' then
      max_actions := 10;
      window_seconds := 60;
    else
      raise exception 'objectif-pal: quota inconnu "%"', action_kind;
  end case;

  -- Dans le DO UPDATE, `limits.*` désigne la ligne EXISTANTE (avant update) :
  -- fenêtre expirée → on repart à 1, sinon on incrémente. Upsert atomique —
  -- deux appels simultanés ne perdent pas de tick.
  insert into public.lookup_rate_limits as limits (user_id, kind, window_started_at, lookup_count)
  values (caller, action_kind, now(), 1)
  on conflict (user_id, kind) do update set
    lookup_count = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then 1
      else limits.lookup_count + 1
    end,
    window_started_at = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then now()
      else limits.window_started_at
    end
  returning limits.lookup_count into current_count;

  return current_count <= max_actions;
end;
$$;
