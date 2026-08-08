import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SplashScreen } from "@/components/splash-screen";
import "./globals.css";

// Capte beforeinstallprompt dès le parsing du <body>, avant que React n'attache
// ses listeners : Chrome peut émettre l'event pendant le chargement, il serait
// sinon perdu et l'installation guidée (#89) resterait muette. useInstallPrompt
// (lib/hooks/use-install-prompt.ts) relit window.__deferredInstallPrompt au
// montage. Script inline via dangerouslySetInnerHTML — l'idiome Next pour le
// code d'avant-hydratation (docs locales : guides/preventing-flash-before-hydration).
// Purement additif : ne touche ni au service worker ni au scan (post-mortem #60).
const installPromptBootScript =
  "window.__deferredInstallPrompt=null;" +
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__deferredInstallPrompt=e})";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Objectif PAL",
  description: "Scanne tes lectures, fais fondre ta pile à lire.",
  appleWebApp: {
    capable: true,
    title: "Objectif PAL",
    statusBarStyle: "black-translucent",
  },
};

// Thème sombre unique (design-specs §2) : une seule couleur de barre système,
// alignée sur --bg0, plus de variante claire/sombre.
// maximumScale: 1 — iOS zoome au focus d'un champ < 16px et, en PWA installée,
// mémorise cette échelle entre les lancements (« ça ouvre zoomé à chaque fois »).
// Ceinture avec le plancher 16px de globals.css ; Safari navigateur ignore ce
// plafond pour le pinch manuel, l'a11y du zoom utilisateur reste intacte.
export const viewport: Viewport = {
  themeColor: "#120826",
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* En tête de <body>, pas dans un <head> manuel : Next gère le <head>
            lui-même (meta theme-color du viewport) — et parser le script avant
            tout contenu suffit à capter l'event. */}
        <script dangerouslySetInnerHTML={{ __html: installPromptBootScript }} />
        {children}
        <SplashScreen />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
