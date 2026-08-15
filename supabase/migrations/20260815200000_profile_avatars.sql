-- Profil personnalisable (issue #224) — la photo de profil.
--
-- Bucket `avatars` SÉPARÉ de `covers`, exprès : la purge mensuelle des
-- orphelins (scripts/maintenance-purge.mjs) ratisse tout le bucket covers et
-- supprime les objets non référencés par un livre — un avatar y serait effacé
-- au premier passage. Le bucket dédié l'immunise sans coupler la purge à
-- `profiles`.
--
-- Un seul objet par utilisateur ({user_id}/avatar.webp, écrasé à chaque
-- changement) : le stockage est plafonné par le nombre de comptes, jamais par
-- le nombre de changements de photo.

alter table profiles add column avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Le même cloisonnement par dossier que `covers` (#33, #46) : chacun n'écrit,
-- ne liste et ne supprime que dans son dossier {user_id}/. La lecture publique
-- passe par l'URL, la policy select sert à `storage.list()` côté serveur.
create policy "avatars_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
