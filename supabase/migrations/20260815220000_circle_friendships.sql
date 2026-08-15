-- Le lien du cercle (specs §4.14, lot A) — unicité du pseudo, porte d'entrée,
-- table des amitiés, recherche et lecture des profils liés.
--
-- Trois principes de §4.14 gravés ici :
--   1. « Agrégats servis, jamais de RLS élargie » — `profiles_select_own` ne
--      bouge pas : le pseudo + photo d'autrui se lit UNIQUEMENT via les deux
--      fonctions `security definer` de ce fichier (recherche bornée, profils
--      liés par une amitié). Jamais l'email : il n'est pas dans `profiles`.
--   2. La porte du cercle : le pseudo par DÉFAUT est le nom Google ou le début
--      de l'email (trigger d'inscription) — un nom SUBI. Seuls les comptes
--      entrés au cercle (`circle_joined_at` posé en confirmant son pseudo)
--      sont cherchables : jamais un nom que personne n'a choisi de publier.
--   3. Le refus/retrait SUPPRIME la ligne (silencieux, re-demande possible
--      bornée par quota) — pas de suppression douce : le lien n'est pas une
--      donnée de lecture, c'est un état relationnel (même esprit que le cache
--      #214 : l'exception à « suppression douce partout » se justifie).

-- ---------------------------------------------------------------------------
-- 1) Le pseudo devient unique (insensible à la casse) + la porte du cercle
-- ---------------------------------------------------------------------------

alter table profiles add column circle_joined_at timestamptz;

-- Dédoublonnage défensif AVANT l'index : les pseudos par défaut peuvent se
-- télescoper (deux « lecteur », deux homonymes Google). Le plus ancien garde
-- le nom, les suivants prennent un suffixe court dérivé de leur id — visible
-- et corrigeable par l'utilisateur au Profil.
update profiles p
set display_name = left(p.display_name, 32) || ' · ' || left(p.id::text, 4)
where exists (
  select 1 from profiles older
  where lower(older.display_name) = lower(p.display_name)
    and older.created_at < p.created_at
);

create unique index profiles_display_name_unique on profiles (lower(display_name));

-- ---------------------------------------------------------------------------
-- 2) friendships — le lien, en paire CANONIQUE (user_low < user_high) : une
--    seule ligne possible par duo, la demande croisée se cogne dessus et
--    devient acceptation (côté action). `id` uuid : la clé de pagination
--    stable de l'export (#178, tri secondaire sur id).
-- ---------------------------------------------------------------------------

create table friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references profiles (id) on delete cascade,
  user_high uuid not null references profiles (id) on delete cascade,
  -- Qui a demandé : départage « demande reçue » / « demande envoyée ».
  requester_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (user_low, user_high),
  check (user_low < user_high),
  check (requester_id in (user_low, user_high))
);

-- Les lectures passent par les deux bouts de la paire ; l'unique couvre
-- user_low, il manque l'autre bout.
create index friendships_user_high_idx on friendships (user_high);

alter table friendships enable row level security;

-- Le test « ce compte est entré au cercle » en `security definer` : une policy
-- qui interrogerait `profiles` en direct subirait sa RLS (chacun le sien) et
-- répondrait toujours faux pour l'AUTRE membre de la paire.
create function is_circle_member(member_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = member_id and p.circle_joined_at is not null
  );
$$;

revoke all on function public.is_circle_member(uuid) from public, anon;
grant execute on function public.is_circle_member(uuid) to authenticated;

create policy "friendships_select_party" on friendships
  for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

-- INSERT : je suis le demandeur, membre de la paire, la demande naît
-- `pending`, et LES DEUX comptes sont entrés au cercle (la porte vaut pour
-- demander comme pour être demandé).
create policy "friendships_insert_requester" on friendships
  for insert to authenticated
  with check (
    (select auth.uid()) = requester_id
    and (select auth.uid()) in (user_low, user_high)
    and status = 'pending'
    and accepted_at is null
    and is_circle_member(user_low)
    and is_circle_member(user_high)
  );

-- UPDATE : seul le DESTINATAIRE accepte, et une amitié acceptée ne se
-- « dé-accepte » pas (le geste inverse est le retrait = DELETE).
create policy "friendships_accept_recipient" on friendships
  for update to authenticated
  using (
    status = 'pending'
    and (select auth.uid()) in (user_low, user_high)
    and (select auth.uid()) <> requester_id
  )
  with check (status = 'accepted' and accepted_at is not null);

-- DELETE : refuser (destinataire), annuler (demandeur), retirer (l'un ou
-- l'autre) — un seul verbe SQL, silencieux dans tous les cas (§4.14).
create policy "friendships_delete_party" on friendships
  for delete to authenticated
  using ((select auth.uid()) in (user_low, user_high));

-- La policy UPDATE ne sait pas figer la paire (pas d'accès à OLD) : sans ce
-- verrou, un destinataire pourrait « déplacer » la ligne vers un autre duo en
-- l'acceptant. Les colonnes d'identité deviennent ineditables par GRANT :
-- l'update ne peut toucher QUE status et accepted_at.
revoke update on friendships from authenticated;
grant update (status, accepted_at) on friendships to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Les deux fonctions de lecture — la SEULE porte vers le profil d'autrui
-- ---------------------------------------------------------------------------

-- La recherche par préfixe (§4.14) : bornée (2 caractères minimum, 10
-- résultats), sous quota, parmi les seuls comptes entrés au cercle, et les
-- jokers LIKE sont échappés — un pseudo « 100% » se cherche littéralement.
create function search_circle_profiles(prefix text)
returns table (id uuid, display_name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  needle text := lower(trim(prefix));
begin
  if caller is null then
    return;
  end if;
  -- La porte : il faut être entré au cercle pour chercher.
  if not exists (
    select 1 from public.profiles me
    where me.id = caller and me.circle_joined_at is not null
  ) then
    return;
  end if;
  if char_length(needle) < 2 then
    return;
  end if;
  if not public.consume_action_quota('friend_search') then
    raise exception 'objectif-pal: quota de recherche atteint';
  end if;
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.display_name, p.avatar_url
    from public.profiles p
    where p.circle_joined_at is not null
      and p.id <> caller
      and lower(p.display_name) like needle || '%'
    order by lower(p.display_name)
    limit 10;
end;
$$;

revoke all on function public.search_circle_profiles(text) from public, anon;
grant execute on function public.search_circle_profiles(text) to authenticated;

-- Les profils LIÉS à l'appelant (demande dans un sens ou l'autre, ou amitié) :
-- de quoi afficher pseudo + photo dans les listes du cercle. Le lien lui-même
-- autorise la lecture — aucun autre profil ne sort d'ici.
create function get_circle_profiles()
returns table (id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url
  from public.profiles p
  where p.id <> (select auth.uid())
    and exists (
      select 1 from public.friendships f
      where (f.user_low = (select auth.uid()) and f.user_high = p.id)
         or (f.user_high = (select auth.uid()) and f.user_low = p.id)
    );
$$;

revoke all on function public.get_circle_profiles() from public, anon;
grant execute on function public.get_circle_profiles() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Les quotas des deux gestes (patron #174 : les seuils vivent DANS la
--    fonction, l'appelant ne choisit que le type d'action)
-- ---------------------------------------------------------------------------

alter table lookup_rate_limits drop constraint lookup_rate_limits_kind_check;
alter table lookup_rate_limits add constraint lookup_rate_limits_kind_check
  check (kind in ('lookup', 'cover_repair', 'friend_search', 'friend_request'));

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
  --   lookup         — 60/min : physiquement inatteignable au scanner (#126),
  --                    ne freine que les boucles ;
  --   cover_repair   — 5/min : la réparation d'une couverture morte est rare
  --                    par nature, une salve est toujours un emballement (#177) ;
  --   friend_search  — 30/min : la frappe débouncée d'un humain qui cherche
  --                    un pseudo, jamais une moisson d'annuaire (§4.14) ;
  --   friend_request — 10/min : on n'invite pas plus vite que ça à la main —
  --                    borne l'acharnement comme le spam (§4.14).
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
