-- Suivi de séries — lot A, le modèle (#291, epic #289, specs §4.17).
--
-- Jusqu'ici une série n'existait pas en base : `books.series_name` est un
-- texte libre comparé en égalité stricte. Le partage entre membres est un
-- objectif (« One Piece » chez Prem et « One piece » chez Léna doivent être
-- la MÊME ligne, sinon les bilans comparés par série mentent à la première
-- graphie) : d'où un référentiel commun, comme GCD — lisible par tout compte,
-- écrit UNIQUEMENT par des RPC `security definer` qui vérifient l'appelant.
--
-- Ce qui est à l'utilisateur : le LIEN livre → série (`books.series_id`) et
-- ses déclarations (`series_events.user_id`). La progression (lus, dans la
-- pile, tome suivant) est DÉRIVÉE par utilisateur, jamais stockée (§4.17-1).
--
-- Les identifiants externes vivent dans une table à part (`series_external_ids`)
-- et non en deux colonnes uniques : mesuré au lot 0 (#294), la BnF donne UNE
-- notice de série PAR ÉDITION (One Piece 2003 ≠ One Piece 2013) — une série
-- porte donc plusieurs identifiants BnF, et une fusion les additionne.

-- 1. La normalisation du nom — le miroir SQL de `normalizeSeriesName`
--    (lib/series/normalize.ts) : minuscules, sans accents (unaccent, forme à
--    deux arguments, cf. 20260815180000), espaces réduits. IMMUTABLE assumé :
--    le dictionnaire unaccent ne change pas sous nos pieds, et la colonne est
--    entretenue par trigger, pas par colonne générée.
create function normalize_series_name(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    extensions.unaccent('extensions.unaccent'::regdictionary, lower(name)),
    '\s+', ' ', 'g'));
$$;
revoke all on function public.normalize_series_name(text) from public, anon;
grant execute on function public.normalize_series_name(text) to authenticated;

-- 2. Le référentiel.
create table series (
  id uuid primary key default gen_random_uuid(),
  -- Le nom canonique, affiché partout (celui de GCD quand il y a un
  -- identifiant GCD, sinon celui du premier qui l'écrit ; renommable).
  name text not null check (length(name) between 1 and 200),
  name_normalized text not null,
  category book_category not null,
  -- LE FAIT DE SÉRIE (§4.17-3) : total déclaré OU parution en cours, jamais
  -- les deux ; qui l'a déclaré et quand, visibles sur la fiche.
  total_volumes integer check (total_volumes between 1 and 5000),
  is_ongoing boolean not null default false,
  fact_declared_by uuid references profiles (id) on delete set null,
  fact_declared_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not (total_volumes is not null and is_ongoing)),
  check ((fact_declared_at is null) = (total_volumes is null and not is_ongoing))
);
comment on table series is
  'Référentiel PARTAGÉ des séries (#291, §4.17) : lisible par tous, écrit par RPC seulement. La progression est dérivée par utilisateur, jamais stockée ici.';
create index series_name_normalized_idx on series (name_normalized);

create function series_set_name_normalized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_normalized := public.normalize_series_name(new.name);
  return new;
end;
$$;
create trigger series_set_name_normalized
  before insert or update of name on series
  for each row execute function series_set_name_normalized();

alter table series enable row level security;
-- Lecture pour tout authentifié (référentiel commun, comme barcode_cache) ;
-- AUCUNE policy d'écriture : les RPC ci-dessous, en security definer, sont
-- la seule porte.
create policy "series_select_authenticated" on series
  for select to authenticated using (true);

-- 3. Les identifiants externes — la colle entre comptes (§4.17-1).
create table series_external_ids (
  series_id uuid not null references series (id) on delete cascade,
  source text not null check (source in ('bnf', 'gcd')),
  external_id text not null check (length(external_id) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (source, external_id)
);
comment on table series_external_ids is
  'Une série peut porter plusieurs identifiants (la BnF en donne un par édition) ; un identifiant ne désigne qu''une série.';
create index series_external_ids_series_idx on series_external_ids (series_id);
alter table series_external_ids enable row level security;
create policy "series_external_ids_select_authenticated" on series_external_ids
  for select to authenticated using (true);

-- 4. L'historique en ajout seul (§4.17-3) : une ligne par déclaration, jamais
--    écrasée. Pas de policy INSERT/UPDATE/DELETE — seules les RPC écrivent.
--    `user_id` en `set null` à la suppression du compte : l'événement reste,
--    anonymisé (RGPD, §4.17-14).
create table series_events (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series (id) on delete cascade,
  kind text not null check (kind in ('declare_total', 'declare_ongoing', 'rename', 'merge')),
  total_volumes integer,
  is_ongoing boolean,
  old_name text,
  new_name text,
  -- La série absorbée n'existe plus après la fusion : pas de FK, on garde l'id.
  merged_series_id uuid,
  user_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table series_events is
  'Historique en ajout seul des déclarations sur les séries (#291) : valeur d''avant retrouvable, auteur visible au cercle.';
create index series_events_series_idx on series_events (series_id, created_at desc);
create index series_events_user_idx on series_events (user_id) where user_id is not null;
alter table series_events enable row level security;
create policy "series_events_select_authenticated" on series_events
  for select to authenticated using (true);

-- 5. Le lien livre → série.
alter table books add column series_id uuid references series (id) on delete set null;
comment on column books.series_id is
  'La série du référentiel partagé (#291). `series_name` reste le texte affiché, synchronisé au rattachement.';
create index books_user_series_idx on books (user_id, series_id) where series_id is not null and deleted_at is null;

-- 6. Le quota des écritures partagées : 30/min — un humain qui déclare,
--    renomme ou fusionne ne fait pas plus, un compte fou ne réécrit pas le
--    référentiel. Patron #174 : le seuil vit ICI. Fonction reprise telle
--    quelle de 20260913130000 (section 5) + le nouveau kind.
alter table lookup_rate_limits drop constraint lookup_rate_limits_kind_check;
alter table lookup_rate_limits add constraint lookup_rate_limits_kind_check
  check (kind in ('lookup', 'cover_repair', 'friend_search', 'friend_request', 'cover_candidates', 'cover_share', 'series_write'));

create or replace function consume_action_quota(action_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_actions integer;
  window_seconds integer;
  current_count integer;
begin
  if caller is null then
    return false;
  end if;
  case action_kind
    when 'lookup' then
      max_actions := 60;
      window_seconds := 60;
    when 'cover_repair' then
      max_actions := 5;
      window_seconds := 60;
    when 'friend_search' then
      max_actions := 30;
      window_seconds := 60;
    when 'friend_request' then
      max_actions := 10;
      window_seconds := 60;
    when 'cover_candidates' then
      max_actions := 10;
      window_seconds := 60;
    when 'cover_share' then
      max_actions := 5;
      window_seconds := 60;
    when 'series_write' then
      max_actions := 30;
      window_seconds := 60;
    else
      raise exception 'objectif-pal: quota inconnu "%"', action_kind;
  end case;
  insert into public.lookup_rate_limits as limits (user_id, kind, window_started_at, lookup_count)
  values (caller, action_kind, now(), 1)
  on conflict (user_id, kind) do update set
    lookup_count = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then 1
      else limits.lookup_count + 1
    end,
    window_started_at = case
      when now() - limits.window_started_at >= make_interval(secs => window_seconds) then now()
      else limits.window_started_at
    end
  returning limits.lookup_count into current_count;
  return current_count <= max_actions;
end;
$$;

-- 7. Le rattachement (§4.17-2) : identifiant externe d'abord, nom normalisé
--    ensuite, création sinon. Un identifiant qui arrive sur une série trouvée
--    par le nom est POSÉ (la série se solidifie). Deux « Spider-Man » à
--    identifiants GCD différents restent deux séries : la recherche par nom
--    écarte les séries qui ont déjà un identifiant GCD quand l'appelant en
--    apporte un autre. Les identifiants BnF ne s'excluent pas (une notice par
--    édition — mesuré #294). Verrou consultatif sur le nom normalisé : deux
--    scans simultanés du même tome ne créent pas deux séries.
--    Appelable sans session (service role : le script de rattachement) —
--    `created_by` est alors null, « système ».
create function find_or_create_series(
  p_name text,
  p_category book_category,
  p_bnf_series_id text default null,
  p_gcd_series_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  normalized text;
  found_id uuid;
begin
  if length(clean_name) < 1 or length(clean_name) > 200 then
    raise exception 'UX: Le nom de la série est vide ou trop long';
  end if;
  normalized := public.normalize_series_name(clean_name);
  perform pg_advisory_xact_lock(hashtext('series:' || normalized));

  -- 1) par identifiant externe.
  if p_gcd_series_id is not null then
    select series_id into found_id from public.series_external_ids
      where source = 'gcd' and external_id = p_gcd_series_id;
  end if;
  if found_id is null and p_bnf_series_id is not null then
    select series_id into found_id from public.series_external_ids
      where source = 'bnf' and external_id = p_bnf_series_id;
  end if;

  -- 2) par nom normalisé — la plus ancienne ; sans conflit d'identifiant GCD.
  if found_id is null then
    select s.id into found_id from public.series s
      where s.name_normalized = normalized
        and (p_gcd_series_id is null or not exists (
          select 1 from public.series_external_ids x where x.series_id = s.id and x.source = 'gcd'))
      order by s.created_at, s.id
      limit 1;
  end if;

  -- 3) création.
  if found_id is null then
    insert into public.series (name, category, created_by)
      values (clean_name, p_category, caller)
      returning id into found_id;
  end if;

  -- La série se solidifie : les identifiants apportés qu'elle n'a pas encore.
  if p_gcd_series_id is not null then
    insert into public.series_external_ids (series_id, source, external_id)
      values (found_id, 'gcd', p_gcd_series_id)
      on conflict (source, external_id) do nothing;
  end if;
  if p_bnf_series_id is not null then
    insert into public.series_external_ids (series_id, source, external_id)
      values (found_id, 'bnf', p_bnf_series_id)
      on conflict (source, external_id) do nothing;
  end if;

  return found_id;
end;
$$;
revoke all on function public.find_or_create_series(text, book_category, text, text) from public, anon;
grant execute on function public.find_or_create_series(text, book_category, text, text) to authenticated, service_role;

-- 8. Relier (ou détacher) UN de ses livres — la série doit exister ; le nom
--    affiché suit le référentiel.
create function link_book_series(p_book_id uuid, p_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_name text;
  touched integer;
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if p_series_id is not null then
    select name into target_name from public.series where id = p_series_id;
    if not found then
      raise exception 'UX: Série introuvable';
    end if;
  end if;
  update public.books
    set series_id = p_series_id,
        series_name = coalesce(target_name, series_name)
    where id = p_book_id and user_id = caller and deleted_at is null;
  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'UX: Livre introuvable';
  end if;
end;
$$;
revoke all on function public.link_book_series(uuid, uuid) from public, anon;
grant execute on function public.link_book_series(uuid, uuid) to authenticated;

-- 9. Déclarer le fait de série (§4.17-3) : total OU parution en cours. Métré.
create function declare_series_fact(p_series_id uuid, p_total_volumes integer, p_is_ongoing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if not public.consume_action_quota('series_write') then
    raise exception 'UX: Trop de modifications d''un coup — attends une minute et réessaie';
  end if;
  if (p_total_volumes is null) = (not coalesce(p_is_ongoing, false)) then
    raise exception 'UX: Un total OU une parution en cours, pas les deux';
  end if;
  if p_total_volumes is not null and (p_total_volumes < 1 or p_total_volumes > 5000) then
    raise exception 'UX: Le total doit être entre 1 et 5000';
  end if;

  update public.series
    set total_volumes = p_total_volumes,
        is_ongoing = coalesce(p_is_ongoing, false),
        fact_declared_by = caller,
        fact_declared_at = now()
    where id = p_series_id;
  if not found then
    raise exception 'UX: Série introuvable';
  end if;

  insert into public.series_events (series_id, kind, total_volumes, is_ongoing, user_id)
    values (p_series_id,
            case when p_total_volumes is null then 'declare_ongoing' else 'declare_total' end,
            p_total_volumes, coalesce(p_is_ongoing, false), caller);
end;
$$;
revoke all on function public.declare_series_fact(uuid, integer, boolean) from public, anon;
grant execute on function public.declare_series_fact(uuid, integer, boolean) to authenticated;

-- 10. Renommer — visible à tous, journalisé ; le nom affiché des livres suit
--     (tous comptes : c'est le référentiel). Métré.
create function rename_series(p_series_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  previous_name text;
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if length(clean_name) < 1 or length(clean_name) > 200 then
    raise exception 'UX: Le nom de la série est vide ou trop long';
  end if;
  if not public.consume_action_quota('series_write') then
    raise exception 'UX: Trop de modifications d''un coup — attends une minute et réessaie';
  end if;

  select name into previous_name from public.series where id = p_series_id for update;
  if not found then
    raise exception 'UX: Série introuvable';
  end if;
  if previous_name = clean_name then
    return;
  end if;

  update public.series set name = clean_name where id = p_series_id;
  update public.books set series_name = clean_name where series_id = p_series_id;
  insert into public.series_events (series_id, kind, old_name, new_name, user_id)
    values (p_series_id, 'rename', previous_name, clean_name, caller);
end;
$$;
revoke all on function public.rename_series(uuid, text) from public, anon;
grant execute on function public.rename_series(uuid, text) to authenticated;

-- 11. Fusionner deux séries (§4.17-9) — rayon global, donc prudence
--     structurelle : deux identifiants GCD différents = deux séries, refus.
--     (Pas pour la BnF : une notice par édition, mesuré #294.) Les livres de
--     TOUS les comptes suivent, les identifiants s'additionnent, l'historique
--     de la série absorbée est rattaché à la conservée, le fait de la
--     conservée l'emporte s'il existe. Métré.
create function merge_series(keep_series_id uuid, merge_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  keep_series public.series;
  merged_series public.series;
begin
  if caller is null then
    raise exception 'UX: Authentification requise';
  end if;
  if keep_series_id = merge_series_id then
    raise exception 'UX: Une série ne se fusionne pas avec elle-même';
  end if;
  if not public.consume_action_quota('series_write') then
    raise exception 'UX: Trop de modifications d''un coup — attends une minute et réessaie';
  end if;

  select * into keep_series from public.series where id = keep_series_id for update;
  if not found then
    raise exception 'UX: Série conservée introuvable';
  end if;
  select * into merged_series from public.series where id = merge_series_id for update;
  if not found then
    raise exception 'UX: Série à fusionner introuvable';
  end if;

  if exists (select 1 from public.series_external_ids where series_id = keep_series_id and source = 'gcd')
     and exists (select 1 from public.series_external_ids where series_id = merge_series_id and source = 'gcd') then
    raise exception 'UX: Ces deux séries sont deux séries différentes chez GCD : pas une graphie, deux séries';
  end if;

  update public.books
    set series_id = keep_series_id, series_name = keep_series.name
    where series_id = merge_series_id;
  update public.series_external_ids set series_id = keep_series_id where series_id = merge_series_id;
  update public.series_events set series_id = keep_series_id where series_id = merge_series_id;

  if keep_series.fact_declared_at is null and merged_series.fact_declared_at is not null then
    update public.series
      set total_volumes = merged_series.total_volumes,
          is_ongoing = merged_series.is_ongoing,
          fact_declared_by = merged_series.fact_declared_by,
          fact_declared_at = merged_series.fact_declared_at
      where id = keep_series_id;
  end if;

  insert into public.series_events (series_id, kind, old_name, new_name, merged_series_id, user_id)
    values (keep_series_id, 'merge', merged_series.name, keep_series.name, merge_series_id, caller);
  delete from public.series where id = merge_series_id;
end;
$$;
revoke all on function public.merge_series(uuid, uuid) from public, anon;
grant execute on function public.merge_series(uuid, uuid) to authenticated;

-- 12. La fusion de DOUBLONS de livres (#100) suit : le conservé hérite du
--     lien série quand il n'en a pas. Corps repris de 20260912180000 + la ligne
--     `series_id`.
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

  update public.readings set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;
  update public.purchases set book_id = keep_book_id
    where book_id = merge_book_id and user_id = caller;

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

  update public.books
  set series_name  = coalesce(keep_book.series_name,  merged_book.series_name),
      series_id    = coalesce(keep_book.series_id,    merged_book.series_id),
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

-- 13. L'indice GCD vivant (§4.17-4) : le plus grand numéro NUMÉRIQUE connu par
--     série dans notre import — calculé à la demande, jamais stocké, il monte
--     avec chaque rafraîchissement du dump. Index (series_id, number) de
--     20260719190000. Service definer pour lire gcd_issues sans exposer la
--     table entière au client.
create function gcd_series_max_issue_numbers(p_series_ids integer[])
returns table (series_id integer, max_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.series_id, max(i.number::integer)
  from public.gcd_issues i
  where i.series_id = any (p_series_ids)
    and i.number ~ '^\d{1,5}$'
  group by i.series_id;
$$;
revoke all on function public.gcd_series_max_issue_numbers(integer[]) from public, anon;
grant execute on function public.gcd_series_max_issue_numbers(integer[]) to authenticated;
