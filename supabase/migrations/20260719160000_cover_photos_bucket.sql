-- Le bucket des photos de couverture (specs §5.4, issue #33) — PUBLIC
-- (décision du 19/07/2026) : URL directe stockée dans books.cover_url comme
-- les couvertures externes, chemins {user_id}/{book_id}.webp indevinables
-- (deux UUID, pas de listing). L'ÉCRITURE reste strictement personnelle
-- (policies par dossier) : le partage de photos entre utilisateurs est une
-- piste multi-user volontairement NON ouverte — l'argument juridique du §5.4
-- tient au « chacun photographie SA pile, aucune redistribution ».
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do update set public = true;

-- Un utilisateur n'écrit que dans SON dossier ({user_id}/…). La lecture passe
-- par l'URL publique du bucket — aucune policy SELECT nécessaire.
create policy "covers_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "covers_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "covers_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
