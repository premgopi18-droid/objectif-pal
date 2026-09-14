-- L'éditeur sans le lieu d'édition (#314, 14/09/2026).
--
-- L'ancien parseur Dublin Core de la BnF (avant le lot 0 de #289) posait
-- « Urban comics (Paris) », « Panini comics (Nice) », « Dupuis (Marcinelle
-- (Belgique)) » ; le parseur UNIMARC actuel ne pose que le nom (214 $c).
-- Mesuré : 646 livres BnF sur 657 et 629 entrées BnF du cache sur 639 portent
-- ce suffixe ; les 26 groupes distincts sont tous des lieux. Le lieu n'est pas
-- une information de l'app : on le retire, en fin de chaîne seulement, un
-- niveau de parenthèses imbriqué compris. Aucune autre source n'est touchée.
-- Idempotente.

update public.books
set publisher = btrim(regexp_replace(publisher, '\s*\((?:[^()]|\([^()]*\))*\)\s*$', ''))
where metadata_source = 'bnf'
  and publisher ~ '\s\((?:[^()]|\([^()]*\))*\)\s*$';

update public.barcode_cache
set publisher = btrim(regexp_replace(publisher, '\s*\((?:[^()]|\([^()]*\))*\)\s*$', ''))
where source = 'bnf'
  and publisher ~ '\s\((?:[^()]|\([^()]*\))*\)\s*$';
