"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Le SegmentedControl piloté par l'URL : changer de segment écrit `?vue=` dans
 * la route (état partageable et rechargeable — décision design §3, param en
 * français assumé). Le SegmentedControl (#66) reste agnostique de la nav ;
 * c'est ce wrapper qui traduit un choix en navigation.
 *
 * `replace` plutôt que `push` : un segment est un filtre de vue, pas une
 * destination — on ne veut pas empiler l'historique à chaque bascule (le bouton
 * retour ramène à l'écran précédent, pas au segment précédent).
 *
 * Le retour immédiat (fluidité #331, item 2) : la page est dynamique et le
 * `loading.tsx` ne se redéclenche pas pour un changement de `?vue=` (même
 * segment de route), donc sans ça RIEN ne bougeait à l'écran pendant tout
 * l'aller-retour serveur — l'utilisateur retapait. La pill se déplace AU TAP
 * (`useOptimistic`, qui retombe sur la valeur serveur à la fin de la
 * transition), et le contenu du volet quitté s'atténue après 150 ms
 * (`delay-150` : une réponse rapide ne fait rien clignoter — le patron du voile
 * temporisé de `card-composer`). Pas de `<Link>` : sur une route dynamique, le
 * prefetch ne rapporterait que le squelette, inutile au même segment (doc
 * locale « linking-and-navigating », Dynamic Route).
 */
type SegmentNavProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  /** Décrit le groupe pour les lecteurs d'écran (ex. « Vue de la bibliothèque »). */
  label: string;
  /** Le volet affiché — atténué pendant la navigation vers le volet suivant. */
  children?: ReactNode;
};

export function SegmentNav<T extends string>({ options, value, label, children }: SegmentNavProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [shownValue, setShownValue] = useOptimistic(value);

  const change = (next: T) => {
    if (next === shownValue) return;
    startTransition(() => {
      setShownValue(next);
      router.replace(`${pathname}?vue=${next}`);
    });
  };

  return (
    <>
      <SegmentedControl options={options} value={shownValue} label={label} onChange={change} />
      <div
        aria-busy={isPending || undefined}
        className={`transition-opacity delay-150 duration-200 ${isPending ? "opacity-60" : ""}`}
      >
        {children}
      </div>
    </>
  );
}
