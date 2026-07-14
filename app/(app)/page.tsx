import { ScanBarcode } from "lucide-react";

/**
 * L'accueil = le Scanner, parce que le geste central de l'app est de scanner
 * un bouquin (specs §1). L'écran caméra arrive dans la branche suivante —
 * ce placeholder fixe déjà la promesse.
 */
export default function ScannerPage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <ScanBarcode aria-hidden className="size-16 text-amber-500" />
      <h1 className="text-2xl font-bold">Scanner un bouquin</h1>
      <p className="max-w-xs text-sm opacity-70">
        Le scan caméra arrive bientôt : code-barres → livre identifié → « je commence » ou « je l&apos;achète ».
      </p>
    </section>
  );
}
