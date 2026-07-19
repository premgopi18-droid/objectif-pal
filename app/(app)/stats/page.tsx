import { redirect } from "next/navigation";

/**
 * `/stats` est conservée mais redirige vers le volet Stats du Bilan
 * (refonte #64, §3) : les Stats sont devenues un segment. Les anciens liens et
 * marque-pages continuent de marcher. `redirect` sert un 307 côté serveur.
 */
export default function StatsPage() {
  redirect("/bilan?vue=stats");
}
