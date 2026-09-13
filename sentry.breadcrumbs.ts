import type { Breadcrumb } from "@sentry/nextjs";

/**
 * Les fils d'Ariane HTTP de Sentry portent l'URL complète des `fetch`
 * sortants — query string comprise. Or deux clés voyagent en query : Google
 * Books (`key=`) et Comic Vine (`api_key=`). Une erreur capturée dans la même
 * requête embarquerait la clé (audit #274). On tronque la query de tout fil
 * d'Ariane `http` ; l'hôte et le chemin suffisent à comprendre une panne.
 */
export function stripBreadcrumbQuery(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== "http" && breadcrumb.category !== "fetch") return breadcrumb;
  const url = breadcrumb.data?.url;
  if (typeof url !== "string") return breadcrumb;
  const cut = url.indexOf("?");
  if (cut === -1) return breadcrumb;
  return { ...breadcrumb, data: { ...breadcrumb.data, url: url.slice(0, cut) } };
}
