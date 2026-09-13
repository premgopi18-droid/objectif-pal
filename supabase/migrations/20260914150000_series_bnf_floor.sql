-- Suivi de séries — le plancher VF par édition (#299, suite de l'epic #289,
-- specs §4.17-4).
--
-- Pour la VO, l'indice GCD (plus grand numéro connu de notre import) pré-remplit
-- le total et signale un total dépassé. Pour la VF, rien : la BnF ne clôt pas
-- ses notices de série (mesuré le 14/09/2026), mais une recherche regroupée
-- par la notice de série (461 $0 — l'identifiant d'édition déjà stocké ici)
-- donne le plus grand tome DÉPOSÉ pour cette édition (One Piece Glénat → 111).
--
-- Le plancher vit PAR ÉDITION, sur l'identifiant, pas sur la série : une
-- série fusionnée porte plusieurs éditions, chacune son plancher. Écrit par le
-- job de nuit (service role) seulement ; lu avec le reste (SELECT déjà ouvert
-- à tout authentifié). JAMAIS une vérité : il pré-remplit, la déclaration
-- humaine reste le seul fait (§4.17-3).

alter table series_external_ids
  add column known_max integer check (known_max between 1 and 5000),
  add column known_max_label text check (known_max_label is null or length(known_max_label) between 1 and 200),
  add column known_max_checked_at timestamptz,
  add constraint series_external_ids_known_max_dated
    check ((known_max is null) or (known_max_checked_at is not null));

comment on column series_external_ids.known_max is
  'Le plus grand numéro de tome connu chez la source pour CETTE édition (#299) — un plancher vivant, jamais une vérité.';
comment on column series_external_ids.known_max_label is
  'L''éditeur de la notice de série (210/214 $c) — « 111 tomes déposés pour l''édition Glénat ».';
comment on column series_external_ids.known_max_checked_at is
  'Quand le job de nuit a relu la source ; les plus anciens repassent en premier.';

-- Le job choisit ses 150 séries par ancienneté : l'index sert à ce tri.
create index series_external_ids_bnf_floor_idx
  on series_external_ids (known_max_checked_at nulls first)
  where source = 'bnf';
