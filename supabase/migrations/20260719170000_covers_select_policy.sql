-- Policy SELECT manquante sur le bucket covers (review #46) : `storage.list()`
-- via le client session est filtré par la RLS — sans SELECT, la vérification
-- d'existence de `recordCoverPhoto` rendait toujours [] et le flux photo
-- échouait systématiquement. Chacun ne liste/lit par l'API que SON dossier ;
-- la lecture publique par URL directe (bucket public) n'est pas concernée.
create policy "covers_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
