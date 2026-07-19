"use client";

import { BarChart3, BookOpen, Layers, Library, ScanBarcode, TrendingUp, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * La barre d'onglets — mobile-first, pouce-first : le Scanner (le geste
 * central) est le premier onglet et la page d'accueil.
 */
// 7 onglets se partagent un max-w-md : les libellés restent COURTS (décision
// #49 — le 7ᵉ onglet plutôt qu'une entrée cachée dans le Profil).
const TABS = [
  { href: "/", label: "Scanner", icon: ScanBarcode },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/pal", label: "PAL", icon: Layers },
  { href: "/bibliotheque", label: "Biblio", icon: Library },
  { href: "/bilan", label: "Bilan", icon: BarChart3 },
  { href: "/stats", label: "Stats", icon: TrendingUp },
  { href: "/profil", label: "Profil", icon: User },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="pb-safe fixed inset-x-0 bottom-0 border-t border-foreground/10 bg-background/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
                  isActive ? "text-amber-500" : "opacity-60 hover:opacity-100"
                }`}
              >
                <Icon aria-hidden className="size-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
