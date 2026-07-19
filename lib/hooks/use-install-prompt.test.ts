import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveInstallVisibility, isIOSSafari, isStandaloneDisplay } from "./use-install-prompt";

/**
 * Les détections lisent navigator / window / matchMedia. L'env vitest est
 * `node` (pas de navigateur), on stubbe donc par cas — même approche que les
 * tests BoxBox dont ce fichier s'inspire. La logique de visibilité, elle, est
 * une dérivation pure (deriveInstallVisibility) : testée sans DOM du tout.
 */

function stubNavigator(userAgent: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isIOSSafari", () => {
  it("reconnaît Safari iPhone", () => {
    stubNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
      5,
    );
    expect(isIOSSafari()).toBe(true);
  });

  it("reconnaît un iPad iPadOS 13+ (UA « Macintosh » + tactile)", () => {
    stubNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
      5,
    );
    expect(isIOSSafari()).toBe(true);
  });

  it("exclut un Mac desktop (Macintosh sans tactile)", () => {
    stubNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
      0,
    );
    expect(isIOSSafari()).toBe(false);
  });

  it("exclut Chrome iOS (CriOS)", () => {
    stubNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/112.0.5615.70 Mobile/15E148 Safari/604.1",
      5,
    );
    expect(isIOSSafari()).toBe(false);
  });

  it("exclut Firefox iOS (FxiOS)", () => {
    stubNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/112.0 Mobile/15E148 Safari/605.1",
      5,
    );
    expect(isIOSSafari()).toBe(false);
  });

  it("exclut Android Chrome", () => {
    stubNavigator(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
      5,
    );
    expect(isIOSSafari()).toBe(false);
  });

  it("exclut Chrome desktop (Windows)", () => {
    stubNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
      0,
    );
    expect(isIOSSafari()).toBe(false);
  });
});

describe("isStandaloneDisplay", () => {
  function stubDisplay({ displayModeStandalone, iosStandalone }: {
    displayModeStandalone: boolean;
    iosStandalone?: boolean;
  }) {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === "(display-mode: standalone)" && displayModeStandalone,
      }),
    });
    vi.stubGlobal("navigator", { standalone: iosStandalone });
  }

  it("détecte le display-mode standalone (Chromium installé)", () => {
    stubDisplay({ displayModeStandalone: true });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it("détecte navigator.standalone (iOS depuis l'écran d'accueil)", () => {
    stubDisplay({ displayModeStandalone: false, iosStandalone: true });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it("reste false dans un onglet navigateur classique", () => {
    stubDisplay({ displayModeStandalone: false, iosStandalone: false });
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe("deriveInstallVisibility", () => {
  const BASE = {
    ready: true,
    isStandalone: false,
    hasNativePrompt: false,
    isIOS: false,
    bannerDismissed: false,
  };

  it("Chrome Android, prompt capté : bannière + Profil + bouton natif", () => {
    expect(deriveInstallVisibility({ ...BASE, hasNativePrompt: true })).toEqual({
      showBanner: true,
      showInSettings: true,
      canPromptInstall: true,
    });
  });

  it("bannière fermée (dismissed) : plus de bannière, mais le Profil reste", () => {
    expect(
      deriveInstallVisibility({ ...BASE, hasNativePrompt: true, bannerDismissed: true }),
    ).toEqual({
      showBanner: false,
      showInSettings: true,
      canPromptInstall: true,
    });
  });

  it("Safari iOS (pas de prompt programmatique) : bannière consigne, pas de bouton", () => {
    expect(deriveInstallVisibility({ ...BASE, isIOS: true })).toEqual({
      showBanner: true,
      showInSettings: true,
      canPromptInstall: false,
    });
  });

  it("Brave / desktop sans prompt : pas de bannière, mais le Profil guide vers le menu", () => {
    expect(deriveInstallVisibility(BASE)).toEqual({
      showBanner: false,
      showInSettings: true,
      canPromptInstall: false,
    });
  });

  it("app déjà installée (standalone) : ni bannière ni Profil", () => {
    expect(
      deriveInstallVisibility({ ...BASE, isStandalone: true, hasNativePrompt: true, isIOS: true }),
    ).toEqual({
      showBanner: false,
      showInSettings: false,
      canPromptInstall: true,
    });
  });

  it("avant les détections (ready=false) : tout reste caché — pas de flash SSR", () => {
    expect(
      deriveInstallVisibility({ ...BASE, ready: false, hasNativePrompt: true }),
    ).toMatchObject({
      showBanner: false,
      showInSettings: false,
    });
  });
});
