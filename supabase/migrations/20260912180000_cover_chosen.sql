-- Choisir sa couverture — lot A (#275, epic #274, décisions du 12/09/2026).
--
-- Jusqu'ici, rien ne distinguait une couverture POSÉE PAR L'APP (cascade,
-- rapatriement #208, réparation #53) d'une couverture VOULUE par
-- l'utilisateur (photo, choix). La règle « filet ultime » (#47) tenait lieu de
-- verrou : une couverture de source était intouchable. Elle est tombée par
-- accident avec #208 (les couvertures rapatriées vivent dans notre bucket,
-- donc passaient pour des photos maison) — on la remplace par un verrou
-- explicite.
--
-- `cover_chosen_at` : NULL = automatique, daté = choisie. Un automatisme ne
-- remplace jamais une couverture choisie qui s'affiche (seule une URL
-- confirmée morte est réparée, et repasse en automatique).

alter table books add column cover_chosen_at timestamptz;
comment on column books.cover_chosen_at is
  'NULL = couverture automatique (cascade, rapatriement, réparation) ; daté = choisie par l''utilisateur (#275) — les automatismes ne la touchent plus.';

-- Le cercle suit le CHOIX (#236 : les terminés du mois en couvertures chez les
-- amis). `books_bump_fact_version` ignore volontairement cover_url (le
-- rapatriement nocturne ne doit pas périmer tous les bilans) : ce trigger
-- dédié ne périme que lorsqu'une couverture CHOISIE change, ou cesse de l'être
-- (retour à l'automatique). Trigger séparé : un `when` qui lit `old` n'est pas
-- permis sur INSERT, et l'existant couvre insert/delete.
create trigger books_bump_fact_version_cover
  after update of cover_url, cover_chosen_at on books
  for each row
  when (old.cover_chosen_at is not null or new.cover_chosen_at is not null)
  execute function bump_fact_version();

-- La fusion (#100) : la couverture CHOISIE gagne, quel que soit le côté ; deux
-- choisies → celle du livre conservé (le geste dit « je garde celui-ci »).
-- Le reste de la fonction est repris tel quel de
-- 20260720190000_merge_books_dedupe_readings.sql.
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
  -- Le doublon absorbé porte une couverture choisie et le conservé non :
  -- c'est le seul cas où le conservé change de couverture.
  merged_cover_wins boolean;
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

  merged_cover_wins := keep_book.cover_chosen_at is null and merged_book.cover_chosen_at is not null;

  -- Les faits changent de livre. `reading_events` suit tout seul : il pointe
  -- `reading_id`, pas `book_id`.
  update public.readings set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;
  -- Les achats ne sont PAS dédoublonnés (choix explicite — cf. l'en-tête de
  -- 20260720190000) : le barème gère les exemplaires multiples (§3.3) et
  -- derivePal ne compte qu'une entrée de pile par livre.
  update public.purchases set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

  -- Dédoublonnage des lectures TERMINÉES redondantes (review #111).
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

  -- Les possessions ne s'additionnent pas (index unique partiel) : fusion,
  -- la plus ancienne acquisition l'emporte, possédé si l'une ne l'a pas vendu.
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

  -- Le livre conservé hérite du code-barres du doublon quand il n'en a pas.
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

  -- Comblement des trous, jamais d'écrasement (même règle que le rescan) —
  -- SAUF la couverture choisie, qui gagne (#275).
  update public.books
  set series_name  = coalesce(keep_book.series_name,  merged_book.series_name),
      issue_number = coalesce(keep_book.issue_number, merged_book.issue_number),
      authors      = coalesce(keep_book.authors,      merged_book.authors),
      publisher    = coalesce(keep_book.publisher,    merged_book.publisher),
      page_count   = coalesce(keep_book.page_count,   merged_book.page_count),
      isbn         = coalesce(keep_book.isbn,         merged_book.isbn),
      cover_url    = case when merged_cover_wins then merged_book.cover_url
                          else coalesce(keep_book.cover_url, merged_book.cover_url) end,
      cover_chosen_at = case when merged_cover_wins then merged_book.cover_chosen_at
                             else keep_book.cover_chosen_at end
  where id = keep_book_id;

  update public.books set deleted_at = now() where id = merge_book_id;
end;
$$;
