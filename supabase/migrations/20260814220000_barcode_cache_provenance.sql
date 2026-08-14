-- Provenance des saisies manuelles dans le cache partagé (issue #179,
-- epic #182).
--
-- `barcode_cache` est écrit pour tous par le premier qui saisit un livre
-- inconnu des bases — sans trace de QUI. À 100 utilisateurs, impossible
-- d'attribuer, corriger ou annuler sélectivement une entrée douteuse.
-- `created_by` ne concerne que les écritures MANUELLES : les résolutions de
-- sources (BnF, Google Books, Metron, GCD) restent système (null).
alter table barcode_cache
  add column created_by uuid references profiles (id) on delete set null;
