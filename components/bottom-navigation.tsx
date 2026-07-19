"use client";

import { BarChart3, BookOpen, Library, ScanBarcode, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * La barre d'onglets — nav 5 onglets, scan au centre (design-specs §3).
 * Journal · Biblio · 🔘 Scanner (FAB) · Bilan · Profil. La PAL est devenue un
 * segment de la Biblio, les Stats un segment du Bilan (voir leurs pages).
 *
 * Le Scanner reste la page d'accueil (`/`) : le geste central de l'app en
 * mérite le bouton central, surélevé et en dégradé signature.
 */
const TABS = [
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/bibliotheque", label: "Biblio", icon: Library },
  { href: "/", label: "Scanner", icon: ScanBarcode, center: true },
  { href: "/bilan", label: "Bilan", icon: BarChart3 },
  { href: "/profil", label: "Profil", icon: User },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg0/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md items-end px-1.5 pt-2">
        {TABS.map(({ href, label, icon: Icon, ...tab }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const isCenter = "center" in tab && tab.center;

          if (isCenter) {
            // Le FAB scan : rond 60px, dégradé, surélevé (déborde de la barre),
            // bordure 4px --bg0, ombre violette. Icône en --bg0 (encre sombre) —
            // pas blanc : décision d'audit contraste #66.
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className="-mt-6 flex flex-col items-center gap-1 rounded-xl text-[10.5px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                >
                  <span className="bg-grad shadow-grad grid size-[60px] place-items-center rounded-full border-4 border-bg0 text-bg0">
                    <Icon aria-hidden className="size-[26px]" />
                  </span>
                  {label}
                </Link>
              </li>
            );
          }

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
                  isActive ? "text-ink" : "text-ink3"
                }`}
              >
                <Icon aria-hidden className="size-[23px]" />
                {label}
                {/* Le trait dégradé 14×3px sous le libellé marque l'onglet actif (§3). */}
                <span
                  aria-hidden
                  className={`h-[3px] w-3.5 rounded-full ${isActive ? "bg-grad" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
