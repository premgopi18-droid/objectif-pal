-- La fusion de doublons (issue #100, second volet).
--
-- Deux saisies manuelles du même livre ne sont pas dédoublonnables à
-- l'écriture : elles ont `barcode_raw` nul, et en PostgreSQL les NULL ne
-- s'égalent pas — la contrainte d'unicité `(user_id, barcode_raw)` ne les
-- bloque donc pas (§7, comportement voulu : on ne peut pas dédupliquer ce qui
-- n'a pas de code). Il fallait un geste pour les réconcilier APRÈS coup.
--
-- Pourquoi une fonction SQL et pas une suite d'appels depuis l'app : la fusion
-- re-pointe des faits dans trois tables puis supprime un livre. À moitié faite
-- — connexion coupée, erreur au milieu —, elle laisserait des lectures
-- orphelines pointant un livre effacé, ou deux possessions actives violant
-- l'index unique. Ici, le corps entier est UNE transaction : tout ou rien.
--
-- `security definer` + `search_path = ''` : la fonction contourne la RLS pour
-- écrire, elle vérifie donc elle-même que **les deux livres appartiennent à
-- l'appelant** — sans quoi n'importe quel authentifié connaissant deux UUID
-- pourrait fusionner la bibliothèque d'autrui.

create or replace function public.merge_books(keep_book_id uuid, merge_book_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  keep_book public.books;
  merged_book public.books;
begin
  if keep_book_id = merge_book_id then
    raise exception 'Un livre ne se fusionne pas avec lui-même';
  end if;

  -- `for update` : on verrouille les deux lignes le temps de la transaction,
  -- pour qu'une fusion concurrente sur le même livre ne s'intercale pas.
  select * into keep_book from public.books
    where id = keep_book_id and user_id = caller and deleted_at is null for update;
  if not found then
    raise exception 'Livre conservé introuvable';
  end if;

  select * into merged_book from public.books
    where id = merge_book_id and user_id = caller and deleted_at is null for update;
  if not found then
    raise exception 'Livre à fusionner introuvable';
  end if;

  -- Deux codes-barres DIFFÉRENTS = deux éditions réelles, pas un doublon de
  -- saisie. On refuse plutôt que de deviner. (Et ça évite un piège : l'unicité
  -- `(user_id, barcode_raw)` couvre les lignes supprimées, donc rescanner le
  -- doublon le ressusciterait et déferait la fusion — cf. résurrection #10.)
  if keep_book.barcode_raw is not null
     and merged_book.barcode_raw is not null
     and keep_book.barcode_raw <> merged_book.barcode_raw then
    raise exception 'Ces deux livres ont des codes-barres différents : ce sont deux éditions, pas un doublon';
  end if;

  -- Les faits changent de livre. `reading_events` suit tout seul : il pointe
  -- `reading_id`, pas `book_id`.
  update public.readings set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;
  update public.purchases set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

  -- Les possessions ne s'additionnent pas : l'index unique partiel
  -- `ownerships_active_book_idx` interdit deux déclarations actives sur un même
  -- livre. On les FUSIONNE — la plus ancienne acquisition connue l'emporte
  -- (`least` ignore les NULL en PostgreSQL), et le livre reste possédé si l'une
  -- des deux ne l'a pas vendu.
  update public.ownerships k
  set owned_since = least(k.owned_since, m.owned_since),
      disposed_at = case
        when k.disposed_at is null or m.disposed_at is null then null
        else greatest(k.disposed_at, m.disposed_at)
      end
  from public.ownerships m
  where k.book_id = keep_book_id and k.user_id = caller and k.deleted_at is null
    and m.book_id = merge_book_id and m.user_id = caller and m.deleted_at is null;

  -- Celle du doublon a été absorbée ci-dessus : on la referme (jamais de DELETE, §7).
  update public.ownerships set deleted_at = now()
  where book_id = merge_book_id and user_id = caller and deleted_at is null
    and exists (
      select 1 from public.ownerships
      where book_id = keep_book_id and user_id = caller and deleted_at is null
    );

  -- Ce qui reste (le livre conservé n'avait aucune possession) change de livre.
  -- Les lignes déjà supprimées suivent aussi : l'index unique ne couvre que les
  -- actives, et l'historique doit rester rattaché au livre survivant.
  update public.ownerships set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

  -- Le livre conservé hérite du code-barres du doublon quand il n'en a pas :
  -- c'est le cas manuel × scanné, et sans ce transfert le livre survivant
  -- resterait non-rescannable. On vide d'abord la source, sinon l'unicité
  -- `(user_id, barcode_raw)` refuserait le doublon de valeur.
  if keep_book.barcode_raw is null and merged_book.barcode_raw is not null then
    update public.books
      set barcode_raw = null, barcode_type = null, barcode_prefix = null
      where id = merge_book_id;
    update public.books
      set barcode_raw = merged_book.barcode_raw,
          barcode_type = merged_book.barcode_type,
          barcode_prefix = merged_book.barcode_prefix
      where id = keep_book_id;
  end if;

  -- Comblement des trous, jamais d'écrasement — même règle que le rescan
  -- (`mergeBookFieldsOnRescan`, §4.2) : la fiche conservée fait foi, le doublon
  -- ne fait que compléter ce qui lui manquait.
  update public.books
  set series_name  = coalesce(keep_book.series_name,  merged_book.series_name),
      issue_number = coalesce(keep_book.issue_number, merged_book.issue_number),
      authors      = coalesce(keep_book.authors,      merged_book.authors),
      publisher    = coalesce(keep_book.publisher,    merged_book.publisher),
      page_count   = coalesce(keep_book.page_count,   merged_book.page_count),
      isbn         = coalesce(keep_book.isbn,         merged_book.isbn),
      cover_url    = coalesce(keep_book.cover_url,    merged_book.cover_url)
  where id = keep_book_id;

  -- Le doublon disparaît des vues, jamais de la base (§7). L'export continue
  -- de l'inclure, et ses faits pointent désormais le livre conservé.
  update public.books set deleted_at = now() where id = merge_book_id;
end;
$$;

-- L'app appelle la fonction via RPC ; elle ne doit pas être exposée à
-- l'anonyme, qui n'a de toute façon pas d'`auth.uid()`.
revoke all on function public.merge_books(uuid, uuid) from public, anon;
grant execute on function public.merge_books(uuid, uuid) to authenticated;
