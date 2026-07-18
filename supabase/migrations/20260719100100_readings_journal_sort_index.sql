-- Index du tri du journal (issue #32, préparation du lot C) : la page trie
-- par started_at desc puis created_at desc sous le filtre user_id — sans
-- index dédié, Postgres triait en mémoire à chaque affichage. L'index colle
-- exactement à l'ORDER BY ; il servira tel quel à la future pagination.
create index readings_user_started_at_idx
  on readings (user_id, started_at desc, created_at desc);
