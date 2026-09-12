-- Review #280 (lot A, #275) : une couverture CHOISIE est forcément une
-- couverture. Les trois écritures (photo, retour à l'automatique, réparation)
-- posent `cover_url` et `cover_chosen_at` ensemble ; `merge_books` prend
-- `merged_book.cover_url` quand le doublon porte le choix — sans cette
-- contrainte, une ligne incohérente (choisie mais vide) ferait vider la
-- couverture du livre conservé. La base garantit désormais l'invariant que le
-- code suppose.

alter table books
  add constraint books_cover_chosen_requires_url
  check (cover_chosen_at is null or cover_url is not null);
