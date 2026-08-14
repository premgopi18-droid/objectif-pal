-- Bornes du bucket `covers` (issue #180, epic #182).
--
-- Le bucket public était créé sans limite de taille ni de type : il héritait
-- du plafond projet (50 MiB) et acceptait n'importe quel contenu — la
-- compression WebP (~60-150 Ko) n'est qu'un confort CÔTÉ CLIENT, contournable
-- en appelant l'API Storage avec son propre token. 2 Mo laisse une marge
-- confortable (>10×) au-dessus de la photo la plus lourde produite par l'app,
-- et les trois types acceptés couvrent la photo maison d'aujourd'hui et le
-- rapatriement des couvertures de demain (phase 2 du plan).

update storage.buckets
set
  file_size_limit = 2097152, -- 2 MiB
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
where id = 'covers';
