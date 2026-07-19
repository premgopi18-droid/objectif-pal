import { redirect } from "next/navigation";

/**
 * `/pal` est conservée mais redirige vers le volet Pile de la Bibliothèque
 * (refonte #64, §3) : la PAL est devenue un segment. Les anciens liens et
 * marque-pages continuent de marcher. `redirect` sert un 307 côté serveur.
 */
export default function PalPage() {
  redirect("/bibliotheque?vue=pile");
}
