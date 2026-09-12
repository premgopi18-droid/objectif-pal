-- Le pool partagé de couvertures — lot D (#278, epic #274, décisions du 12/09/2026).
--
-- L'app est NON COMMERCIALE (§5.4) : l'argument « aucune redistribution » qui
-- fermait le pool tombe. Une couverture qu'un utilisateur a photographiée ou
-- choisie peut être PROPOSÉE aux autres pour le même code-barres — proposée,
-- jamais imposée : c'est une candidate de plus dans la feuille, étiquetée au
-- pseudo si le contributeur a rejoint le cercle, anonyme sinon (§4.14 : les
-- défauts Google/email ne fuient jamais). Elle ne devient couverture par
-- défaut au scan que pour un code qu'aucune source ne couvre.
--
-- La contribution vit dans un dossier COMMUN du bucket (`shared/{barcode}/…`),
-- copiée par le serveur : elle survit à la suppression du compte du
-- contributeur (le dossier {user_id}/ est purgé à la suppression, et la
-- réparation #53 ignore les URLs de notre bucket — une contribution laissée
-- chez lui deviendrait un lien mort irréparable chez ceux qui l'ont prise).
-- La ligne, elle, part par cascade ; le fichier reste tant qu'un livre le
-- référence, puis la purge #205 le ramasse.
--
-- Jamais dans `barcode_cache` (#179) : le cache partagé refuse les URLs du bucket.

create table cover_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- Le code EXACT du livre (supplément compris) : une contribution sur une
  -- cover B ne se propose qu'aux cover B.
  barcode text not null,
  -- L'URL publique de la COPIE dans le dossier commun — jamais un dossier utilisateur.
  cover_url text not null check (position('/storage/v1/object/public/covers/shared/' in cover_url) > 0),
  -- La couverture du contributeur au moment du partage : si elle change, la
  -- contribution ne la reflète plus (« Partager la nouvelle couverture »).
  source_cover_url text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (barcode, user_id)
);
comment on table cover_contributions is
  'Pool partagé de couvertures (#278) : une copie dans covers/shared/, proposée aux autres pour le même code-barres — proposée, jamais imposée.';

create index cover_contributions_live_barcode_idx on cover_contributions (barcode) where deleted_at is null;

alter table cover_contributions enable row level security;

-- Tout le monde LIT les contributions vivantes (c'est le but) ; on n'écrit que
-- les siennes ; retrait doux seulement (pas de policy DELETE, §7).
create policy "cover_contributions_select_live" on cover_contributions
  for select to authenticated using (deleted_at is null);
create policy "cover_contributions_insert_own" on cover_contributions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "cover_contributions_update_own" on cover_contributions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Les contributions des AUTRES pour un code, avec le pseudo seulement si le
-- contributeur a rejoint le cercle (motif `search_circle_profiles`, §4.14) :
-- `profiles` reste lisible par soi seul, l'étiquette sort d'ici ou de nulle part.
create function get_cover_contributions(target_barcode text)
returns table (cover_url text, contributor_label text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select c.cover_url,
         case when p.circle_joined_at is not null then p.display_name else null end as contributor_label,
         c.created_at
  from public.cover_contributions c
  join public.profiles p on p.id = c.user_id
  where c.barcode = target_barcode
    and c.deleted_at is null
    and c.user_id <> (select auth.uid())
  order by c.created_at desc
  limit 10;
$$;

revoke all on function public.get_cover_contributions(text) from public, anon;
grant execute on function public.get_cover_contributions(text) to authenticated;
