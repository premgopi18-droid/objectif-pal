-- La fusion dédoublonne les lectures redondantes (review #111).
--
-- `merge_books` re-pointait les lectures sans les regarder. Or le cas NOMINAL
-- du ticket — deux saisies manuelles du même livre, chacune marquée « j'ai
-- déjà lu » — donnait au livre conservé **deux lectures terminées identiques**.
--
-- C'est exactement l'état que `recordPastReading` refuse (« une lecture
-- terminée sans date existe déjà, en redéclarer une n'ajoute aucune
-- information ») et qu'on a corrigé en #107 parce qu'il **comptait les points
-- deux fois au bilan**. La fusion le réintroduisait par une autre porte.
--
-- Règle : après le re-pointage, une seule lecture terminée survit par
-- `finished_at` — **les deux NULL compris**, `is not distinct from` traitant
-- NULL comme une valeur comparable. La plus ancienne est gardée (`created_at`,
-- puis `id` pour départager), les autres sont **marquées supprimées** — jamais
-- effacées (§7), donc l'export continue de tout montrer et le geste reste
-- réversible en base.
--
-- Les ACHATS ne sont volontairement PAS dédoublonnés : contrairement aux
-- lectures, le barème sait gérer les exemplaires multiples (§3.3 — deux
-- exemplaires achetés le même mois, un seul lu, les deux malus s'annulent) et
-- `derivePal` ne compte qu'UNE entrée de pile par livre. Deux achats après
-- fusion restent donc deux faits d'achat cohérents ; si l'un est une saisie en
-- double, « je ne l'ai pas acheté » le corrige d'un tap.

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
    raise exception 'UX: Un livre ne se fusionne pas avec lui-même';
  end if;

  select * into keep_book from public.books
    where id = keep_book_id and user_id = caller and deleted_at is null for update;
  if not found then
    raise exception 'UX: Livre conservé introuvable';
  end if;

  select * into merged_book from public.books
    where id = merge_book_id and user_id = caller and deleted_at is null for update;
  if not found then
    raise exception 'UX: Livre à fusionner introuvable';
  end if;

  if keep_book.barcode_raw is not null
     and merged_book.barcode_raw is not null
     and keep_book.barcode_raw <> merged_book.barcode_raw then
    raise exception 'UX: Ces deux livres ont des codes-barres différents : ce sont deux éditions, pas un doublon';
  end if;

  -- Les faits changent de livre. `reading_events` suit tout seul : il pointe
  -- `reading_id`, pas `book_id`.
  update public.readings set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;
  -- Les achats ne sont PAS dédoublonnés (choix explicite — cf. l'en-tête) : le
  -- barème gère les exemplaires multiples (§3.3) et derivePal ne compte qu'une
  -- entrée de pile par livre. Ce n'est donc pas un oubli.
  update public.purchases set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

  -- Dédoublonnage des lectures TERMINÉES redondantes (review #111) : deux fins
  -- à la même date — ou deux fins sans date — sur un même livre ne sont pas
  -- deux lectures, c'est la même saisie deux fois, et elle compterait double
  -- au bilan. On garde la plus ancienne, on marque les autres.
  update public.readings r set deleted_at = now()
  where r.user_id = caller
    and r.book_id = keep_book_id
    and r.status = 'finished'
    and r.deleted_at is null
    and exists (
      select 1 from public.readings survivor
      where survivor.user_id = caller
        and survivor.book_id = keep_book_id
        and survivor.status = 'finished'
        and survivor.deleted_at is null
        and survivor.finished_at is not distinct from r.finished_at
        and (survivor.created_at, survivor.id) < (r.created_at, r.id)
    );

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

  update public.ownerships set deleted_at = now()
  where book_id = merge_book_id and user_id = caller and deleted_at is null
    and exists (
      select 1 from public.ownerships
      where book_id = keep_book_id and user_id = caller and deleted_at is null
    );

  update public.ownerships set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

  -- Le livre conservé hérite du code-barres du doublon quand il n'en a pas :
  -- c'est le cas manuel × scanné, et sans ce transfert le survivant resterait
  -- non-rescannable. On vide d'abord la source, sinon l'unicité
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
  -- (`mergeBookFieldsOnRescan`, §4.2).
  update public.books
  set series_name  = coalesce(keep_book.series_name,  merged_book.series_name),
      issue_number = coalesce(keep_book.issue_number, merged_book.issue_number),
      authors      = coalesce(keep_book.authors,      merged_book.authors),
      publisher    = coalesce(keep_book.publisher,    merged_book.publisher),
      page_count   = coalesce(keep_book.page_count,   merged_book.page_count),
      isbn         = coalesce(keep_book.isbn,         merged_book.isbn),
      cover_url    = coalesce(keep_book.cover_url,    merged_book.cover_url)
  where id = keep_book_id;

  update public.books set deleted_at = now() where id = merge_book_id;
end;
$$;
