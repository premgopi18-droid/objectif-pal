import { ScanScreen } from "@/components/scan/scan-screen";

/**
 * L'accueil = le Scanner : le geste central de l'app (specs §1). Caméra ZXing,
 * saisie du code au clavier, ou saisie manuelle complète — le scan ne peut pas
 * échouer.
 */
export default function ScannerPage() {
  return <ScanScreen />;
}
