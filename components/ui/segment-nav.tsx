"use client";

import { usePathname, useRouter } from "next/navigation";

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
 */
type SegmentNavProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  /** Décrit le groupe pour les lecteurs d'écran (ex. « Vue de la bibliothèque »). */
  label: string;
};

export function SegmentNav<T extends string>({ options, value, label }: SegmentNavProps<T>) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <SegmentedControl
      options={options}
      value={value}
      label={label}
      onChange={(next) => router.replace(`${pathname}?vue=${next}`)}
    />
  );
}
