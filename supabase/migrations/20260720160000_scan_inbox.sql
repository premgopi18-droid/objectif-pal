-- La boîte de finition du scan d'étagère (issue #101, lot C).
--
-- Le principe de la rafale : **la chaîne ne s'arrête jamais**. Scanner une
-- étagère, c'est 50 scans d'affilée ; s'arrêter sur chaque livre introuvable
-- ou mal résolu, c'est abandonner au dixième. Tout ce qui demande de
-- l'attention est donc CAPTÉ ici et traité plus tard, sur le canapé.
--
-- Pourquoi une table dédiée plutôt que des `books` à moitié remplis :
--   • `books.title` est NOT NULL, et aucune vue ni stat n'a à gérer des fiches
--     squelettes — la Biblio, la PAL et le bilan resteraient à filtrer ;
--   • c'est une zone de TRANSIT explicite : un élément y est `pending` ou
--     `completed`, jamais un demi-livre qui traîne dans les compteurs ;
--   • elle SURVIT aux sessions (on scanne à la cave, on complète le soir) —
--     un état client aurait disparu au premier rafraîchissement.
--
-- Comme partout : dates en `date` (§7), suppression douce, RLS activée.

create type scan_intent as enum ('own', 'own_read');
create type scan_inbox_status as enum ('pending', 'completed');

create table scan_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- Le code tel que scanné. NULL quand il n'y en a pas (vieux livre sans
  -- code-barres) : la photo de couverture sert alors de capture.
  barcode_raw text,
  barcode_type text check (barcode_type in ('isbn', 'upc')),
  -- La couverture trouvée par la cascade malgré l'identification ratée
  -- (« image oui, infos non », §5.4) OU la photo prise faute de code-barres.
  cover_url text,
  -- Ce que la cascade a trouvé de PARTIEL — pré-remplira la saisie de
  -- finition. jsonb parce que la forme dépend de la source qui a répondu ;
  -- rien ici n'est lu par un moteur, c'est un brouillon d'affichage.
  resolved_metadata jsonb,
  -- L'INTENTION déclarée au moment du scan. C'est elle qui fait qu'on ne
  -- redemande jamais rien à la finition : l'utilisateur a déjà répondu.
  intent scan_intent not null,
  -- Les dates déclarées avec l'intention — nullables comme partout dans #101
  -- (l'étagère d'avant n'a pas de date connue).
  owned_since date,
  finished_at date,
  status scan_inbox_status not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  -- Un élément sans code-barres DOIT porter une photo, sinon il ne reste rien
  -- pour identifier le livre à la finition — ce serait une ligne morte.
  constraint scan_inbox_identifiable check (barcode_raw is not null or cover_url is not null)
);

-- La requête de la boîte : les éléments à traiter, du plus ancien au plus
-- récent (on finit ce qu'on a commencé). Index partiel : seuls les `pending`
-- sont listés, et ils sont peu nombreux par nature.
create index scan_inbox_pending_idx
  on scan_inbox (user_id, created_at)
  where status = 'pending' and deleted_at is null;

-- La garde du doublon en rafale : « ce code est-il déjà dans la boîte ? »
create index scan_inbox_barcode_idx on scan_inbox (user_id, barcode_raw)
  where status = 'pending' and deleted_at is null;

alter table scan_inbox enable row level security;

create policy "scan_inbox_select_own" on scan_inbox
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "scan_inbox_insert_own" on scan_inbox
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "scan_inbox_update_own" on scan_inbox
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- Pas de policy DELETE : suppression douce uniquement (§7). Écarter un élément
-- (scan raté, livre de quelqu'un d'autre) renseigne `deleted_at`.
