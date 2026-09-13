-- Suivi de séries — lot 0 (#290, epic #289, specs §4.17).
--
-- Le provider BnF lit désormais la notice UNIMARC : la zone 461 porte la
-- série, le tome ET le numéro de la notice de série (`$0`) — un identifiant
-- stable d'un tome à l'autre. GCD, lui, a toujours eu `series_id`. Ces deux
-- identifiants sont la colle entre comptes du futur référentiel partagé
-- (lot A) : on les mémorise dès maintenant dans le cache de résolutions pour
-- que le rattachement des livres existants ne repaie pas les appels BnF.
--
-- Deux colonnes qui vont ENSEMBLE (les deux nulles, ou les deux posées) : la
-- source dit dans quel système lire l'identifiant. Pas de colonne sur
-- `books` dans ce lot — le modèle (table `series`, `books.series_id`) est
-- l'affaire du lot A.

alter table barcode_cache
  add column series_external_source text
    check (series_external_source in ('bnf', 'gcd')),
  add column series_external_id text
    check (series_external_id is null or (length(series_external_id) between 1 and 64)),
  add constraint barcode_cache_series_ref_paired
    check ((series_external_source is null) = (series_external_id is null));

comment on column barcode_cache.series_external_source is
  'Le système qui modélise la série (#290) : bnf = notice de série (461 $0), gcd = gcd_series.id. NULL = la source ne la connaît pas.';
comment on column barcode_cache.series_external_id is
  'L''identifiant de la série chez cette source (#290) — texte : les deux systèmes n''ont pas le même format.';
