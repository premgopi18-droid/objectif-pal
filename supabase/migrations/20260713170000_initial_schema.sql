-- Schéma initial — specs §7 (docs/product-specs.md).
-- Principes non négociables :
--   - RLS partout, user_id sur chaque table utilisateur ;
--   - dates de lecture et d'achat en `date`, jamais en timestamptz (bilan mensuel, §7) ;
--   - suppression douce (`deleted_at`) sur books, readings, purchases — aucun DELETE ;
--   - aucun stockage de score : tout est dérivé en TypeScript (lib/scoring/).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type book_category as enum ('issue', 'manga', 'bd', 'comics', 'omnibus', 'roman');
create type barcode_type as enum ('isbn', 'upc');
create type reading_status as enum ('reading', 'finished', 'abandoned');
create type metadata_source as enum ('gcd', 'bnf', 'google_books', 'metron', 'manual');
create type pick_kind as enum ('favorite', 'good_surprise', 'bad_surprise');

-- ---------------------------------------------------------------------------
-- profiles — un par utilisateur, créé automatiquement à l'inscription
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- À l'inscription Google OAuth, le profil se crée tout seul depuis les métadonnées du compte.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Triple filet : un trigger qui échoue annulerait l'inscription entière.
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'lecteur')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- books — le bouquin en tant qu'objet, tel que l'utilisateur l'a enregistré
-- ---------------------------------------------------------------------------

create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  series_name text,
  issue_number text,
  authors text,
  publisher text,
  page_count integer,
  category book_category not null,
  -- Le code TEL QUE SCANNÉ, supplément inclus : c'est le pont qui permet de
  -- re-résoudre tout l'historique si on change de source (§7).
  barcode_raw text,
  barcode_type barcode_type,
  barcode_prefix text,
  isbn text,
  -- URL distante (Metron / Google Books) OU chemin Supabase Storage si photo.
  cover_url text,
  metadata_source metadata_source not null default 'manual',
  -- L'identifiant chez la source (dont le gcd_id — le filtre le plus précis pour Metron).
  metadata_source_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Un rescan réutilise le livre existant, jamais de doublon (§4.2).
  -- Les saisies manuelles ont un barcode_raw NULL : la contrainte ne les bloque pas.
  unique (user_id, barcode_raw)
);

create index books_user_id_idx on books (user_id);
create index books_barcode_prefix_idx on books (barcode_prefix);

alter table books enable row level security;

create policy "books_select_own" on books
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "books_insert_own" on books
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "books_update_own" on books
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Pas de policy DELETE : suppression douce uniquement (deleted_at).

-- ---------------------------------------------------------------------------
-- readings — une lecture (relire = une nouvelle ligne, même book_id)
-- ---------------------------------------------------------------------------

create table readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  book_id uuid not null references books (id),
  -- L'état COURANT — une commodité de lecture ; la vérité historique vit dans reading_events.
  status reading_status not null default 'reading',
  -- Librement saisissable, jamais forcée à « maintenant » (import rétroactif, §4.2).
  started_at date not null,
  -- C'est elle qui date les points (§3).
  finished_at date,
  -- Note sur 5, demi-étoiles permises (0,5 → 5). Facultative, comme le commentaire.
  rating numeric(2, 1),
  comment text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint readings_rating_half_stars check (
    rating is null or (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2))
  ),
  constraint readings_finished_has_date check (
    status <> 'finished' or finished_at is not null
  )
);

-- L'index du bilan mensuel : une requête par mois, sur cette paire et rien d'autre (§8).
create index readings_user_finished_idx on readings (user_id, finished_at);
create index readings_book_id_idx on readings (book_id);

alter table readings enable row level security;

create policy "readings_select_own" on readings
  for select to authenticated using ((select auth.uid()) = user_id);
-- Le with check vérifie aussi que le book_id référencé APPARTIENT à l'utilisateur :
-- sans ça, n'importe quel authentifié connaissant un UUID d'autrui pourrait s'y accrocher.
create policy "readings_insert_own" on readings
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
create policy "readings_update_own" on readings
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
-- Pas de policy DELETE : suppression douce uniquement.

-- ---------------------------------------------------------------------------
-- reading_events — le journal d'états, en APPEND-ONLY (§4.2)
-- ---------------------------------------------------------------------------

create table reading_events (
  id bigint generated always as identity primary key,
  reading_id uuid not null references readings (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  status reading_status not null,
  occurred_at timestamptz not null default now()
);

create index reading_events_reading_id_idx on reading_events (reading_id);

alter table reading_events enable row level security;

create policy "reading_events_select_own" on reading_events
  for select to authenticated using ((select auth.uid()) = user_id);
-- Propriété de la lecture vérifiée : la table est append-only, un événement injecté
-- sur la lecture d'autrui serait impossible à nettoyer.
create policy "reading_events_insert_own" on reading_events
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from readings r where r.id = reading_id and r.user_id = (select auth.uid()))
  );
-- Ni UPDATE ni DELETE : append-only, c'est ce qui garantit les stats d'abandons et de reprises.

-- ---------------------------------------------------------------------------
-- purchases — un achat (ne se transforme JAMAIS en lecture, §4.6)
-- ---------------------------------------------------------------------------

create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  book_id uuid not null references books (id),
  purchased_at date not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- L'autre index du bilan mensuel (§8).
create index purchases_user_purchased_idx on purchases (user_id, purchased_at);
create index purchases_book_id_idx on purchases (book_id);

alter table purchases enable row level security;

create policy "purchases_select_own" on purchases
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "purchases_insert_own" on purchases
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
create policy "purchases_update_own" on purchases
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
-- Pas de policy DELETE : suppression douce uniquement.

-- ---------------------------------------------------------------------------
-- Distinctions et objectifs mensuels (P1 — le schéma est prêt, l'UI attendra)
-- ---------------------------------------------------------------------------

create table monthly_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- Toujours le 1er du mois : un mois, pas une date.
  month date not null check (extract(day from month) = 1),
  kind pick_kind not null,
  reading_id uuid not null references readings (id),
  comment text,
  created_at timestamptz not null default now(),
  -- Une distinction de chaque type par mois au maximum (§7).
  unique (user_id, month, kind)
);

alter table monthly_picks enable row level security;

create policy "monthly_picks_all_own" on monthly_picks
  for all to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from readings r where r.id = reading_id and r.user_id = (select auth.uid()))
  );

create table monthly_objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table monthly_objectives enable row level security;

create policy "monthly_objectives_all_own" on monthly_objectives
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table objective_targets (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references monthly_objectives (id) on delete cascade,
  category book_category not null,
  -- 0 = catégorie non visée → pas de ligne du tout.
  target_count integer not null check (target_count > 0),
  unique (objective_id, category)
);

alter table objective_targets enable row level security;

-- L'appartenance passe par l'objectif parent.
create policy "objective_targets_all_own" on objective_targets
  for all to authenticated
  using (exists (
    select 1 from monthly_objectives o
    where o.id = objective_id and o.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from monthly_objectives o
    where o.id = objective_id and o.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Tables de référence GCD — pur import, JETABLES (écrasées à chaque refresh, §6)
-- ---------------------------------------------------------------------------

create table gcd_issues (
  -- PK synthétique : un même gcd_id apparaît sur plusieurs lignes quand une issue
  -- a plusieurs codes-barres (variantes) — l'export écrit une ligne par code.
  id bigint generated always as identity primary key,
  gcd_id bigint not null,
  barcode text,
  barcode_prefix text,
  series_id bigint,
  number text,
  page_count numeric,
  -- text, pas date : GCD stocke des dates partielles («1990-10-00») invalides en SQL.
  key_date text,
  isbn text,
  title text
);

create index gcd_issues_barcode_idx on gcd_issues (barcode);
create index gcd_issues_barcode_prefix_idx on gcd_issues (barcode_prefix);
create index gcd_issues_isbn_idx on gcd_issues (isbn);
create index gcd_issues_gcd_id_idx on gcd_issues (gcd_id);

create table gcd_series (
  id bigint primary key,
  name text,
  format text,
  year_began integer,
  publisher text,
  language_id integer
);

-- ---------------------------------------------------------------------------
-- barcode_cache — NOTRE table, jamais écrasée : les résolutions BnF / Metron /
-- Google Books. Séparée de gcd_issues, sinon chaque refresh du dump les détruirait (§6).
-- ---------------------------------------------------------------------------

create table barcode_cache (
  -- UPC ou ISBN, tel que scanné.
  barcode text primary key,
  title text,
  series_name text,
  issue_number text,
  authors text,
  publisher text,
  page_count integer,
  cover_url text,
  source metadata_source not null,
  source_id text,
  resolved_at timestamptz not null default now()
);

-- Données publiques : pas de user_id, lecture seule pour les utilisateurs authentifiés,
-- aucune écriture depuis le client — seul le serveur écrit (service role, qui bypasse la RLS).
alter table gcd_issues enable row level security;
alter table gcd_series enable row level security;
alter table barcode_cache enable row level security;

create policy "gcd_issues_read" on gcd_issues for select to authenticated using (true);
create policy "gcd_series_read" on gcd_series for select to authenticated using (true);
create policy "barcode_cache_read" on barcode_cache for select to authenticated using (true);
