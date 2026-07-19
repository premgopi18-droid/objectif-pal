import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

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
export const viewport: Viewport = {
  themeColor: "#120826",
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
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
