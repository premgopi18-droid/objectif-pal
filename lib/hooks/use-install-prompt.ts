"use client";

import { useEffect, useState } from "react";

/**
 * L'installation guidée de la PWA (#89) — le hook central, transposé du pattern
 * éprouvé de BoxBox. Il agrège trois signaux (prompt natif Chromium capté,
 * plateforme iOS Safari, app déjà en standalone) et une préférence (bannière
 * fermée) pour piloter la bannière ET la ligne du Profil.
 *
 * Toutes les détections se font au `useEffect`, jamais à l'init du state :
 * le serveur ne connaît ni l'UA ni localStorage, un état initial « détecté »
 * créerait un mismatch d'hydratation. Les défauts (standalone=true,
 * dismissed=true, ready=false) rendent tout invisible tant qu'on n'a pas lu
 * le navigateur.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    // Event beforeinstallprompt capté avant l'hydratation par le boot script
    // du layout racine (cf. installPromptBootScript dans app/layout.tsx).
    __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

// UNE clé, qui n'affecte QUE la bannière — jamais la ligne du Profil.
const DISMISSED_STORAGE_KEY = "install-banner-dismissed";

/**
 * Safari iOS uniquement : les autres navigateurs iOS (Chrome/Firefox/Edge/Opera)
 * n'exposent pas l'option « Sur l'écran d'accueil » → inutile (et trompeur) de
 * leur montrer la consigne Partager. iPadOS 13+ se présente comme « Macintosh » :
 * on le distingue d'un vrai Mac via le tactile. Exportée pour test unitaire.
 */
export function isIOSSafari(): boolean {
  const userAgent = navigator.userAgent;
  const isIOSDevice =
    /iphone|ipad|ipod/i.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return isIOSDevice && !isOtherIOSBrowser;
}

/**
 * App déjà installée et lancée depuis l'écran d'accueil ? `display-mode` couvre
 * Chromium/desktop, `navigator.standalone` est le legacy iOS. Exportée pour test.
 */
export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export interface InstallSignals {
  /** Détections faites (on est monté côté client) — avant, tout reste caché. */
  ready: boolean;
  isStandalone: boolean;
  /** L'event beforeinstallprompt a été capté (Chromium avec prompt actif). */
  hasNativePrompt: boolean;
  isIOS: boolean;
  bannerDismissed: boolean;
}

/**
 * La dérivation pure des visibilités — la vérité unique des conditions du
 * ticket #89, testable sans DOM :
 * - bannière : installable « en un geste » (prompt natif OU consigne iOS) et
 *   pas encore fermée ;
 * - Profil : visible dès que l'app n'est pas installée, quelle que soit la
 *   plateforme. Volontairement PAS conditionné au prompt : Brave et les
 *   Chromium modifiés neutralisent `beforeinstallprompt` mais installent via
 *   leur menu — masquer l'option les priverait du seul point d'entrée. La
 *   guidance s'adapte au lieu de masquer (cf. InstallSection).
 */
export function deriveInstallVisibility(signals: InstallSignals): {
  showBanner: boolean;
  showInSettings: boolean;
  canPromptInstall: boolean;
} {
  const { ready, isStandalone, hasNativePrompt, isIOS, bannerDismissed } = signals;
  const canInstall = ready && !isStandalone && (hasNativePrompt || isIOS);
  return {
    showBanner: canInstall && !bannerDismissed,
    showInSettings: ready && !isStandalone,
    canPromptInstall: hasNativePrompt,
  };
}

export function useInstallPrompt() {
  const [nativePrompt, setNativePrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Lecture des capacités navigateur au montage (pas à l'init — hydratation).
    // Encapsulée dans une fonction : react-hooks proscrit un setState synchrone
    // direct dans le corps d'un effet (même pattern que components/splash-screen.tsx).
    function detect() {
      setIsStandalone(isStandaloneDisplay());
      setBannerDismissed(localStorage.getItem(DISMISSED_STORAGE_KEY) === "true");
      setIsIOS(isIOSSafari());
      setReady(true);
      // Event éventuellement déclenché avant le montage, capté par le boot script.
      if (window.__deferredInstallPrompt) setNativePrompt(window.__deferredInstallPrompt);
    }
    detect();

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setNativePrompt(event as BeforeInstallPromptEvent);
    }
    // Installation terminée (bouton natif OU menu du navigateur) → masque
    // bannière et ligne Profil sans attendre un rechargement. (iOS ne l'émet pas.)
    function onAppInstalled() {
      setIsStandalone(true);
      window.__deferredInstallPrompt = null;
      setNativePrompt(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const { showBanner, showInSettings, canPromptInstall } = deriveInstallVisibility({
    ready,
    isStandalone,
    hasNativePrompt: nativePrompt !== null,
    isIOS,
    bannerDismissed,
  });

  function dismissBanner() {
    localStorage.setItem(DISMISSED_STORAGE_KEY, "true");
    setBannerDismissed(true);
  }

  async function install() {
    if (!nativePrompt) return;
    try {
      await nativePrompt.prompt();
      const { outcome } = await nativePrompt.userChoice;
      if (outcome === "accepted") setIsStandalone(true);
      else dismissBanner();
    } finally {
      // L'event beforeinstallprompt est à usage unique : un 2e prompt() jette
      // InvalidStateError. On le consomme pour interdire tout réappel (ex.
      // depuis le Profil après un refus sur la bannière).
      window.__deferredInstallPrompt = null;
      setNativePrompt(null);
    }
  }

  return { isIOS, showBanner, showInSettings, canPromptInstall, install, dismissBanner };
}
