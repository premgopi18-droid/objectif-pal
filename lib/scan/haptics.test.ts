import { afterEach, describe, expect, it, vi } from "vitest";
import { HAPTIC_PATTERNS, HAPTICS_STORAGE_KEY, isHapticsEnabled, setHapticsEnabled, vibrate } from "./haptics";

/**
 * L'haptique de la rafale (fluidité #332, item 8) : le motif par statut, le
 * réglage, et le silence sans API.
 */
function stubBrowser(options: { vibrate?: ReturnType<typeof vi.fn>; stored?: string | null }) {
  const store = new Map<string, string>();
  if (options.stored) store.set(HAPTICS_STORAGE_KEY, options.stored);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  vi.stubGlobal("navigator", options.vibrate ? { vibrate: options.vibrate } : {});
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("vibrate — l'haptique de la rafale", () => {
  it("vibre selon le motif du statut quand l'appareil sait et que le réglage est actif (défaut)", () => {
    const vibrateApi = vi.fn(() => true);
    stubBrowser({ vibrate: vibrateApi });
    expect(vibrate("duplicate")).toBe(true);
    expect(vibrateApi).toHaveBeenCalledWith(HAPTIC_PATTERNS.duplicate);
  });

  it("silence sans navigator.vibrate (iOS Safari), sans erreur", () => {
    stubBrowser({});
    expect(vibrate("read")).toBe(false);
  });

  it("silence quand le réglage est coupé", () => {
    const vibrateApi = vi.fn(() => true);
    stubBrowser({ vibrate: vibrateApi, stored: "off" });
    expect(isHapticsEnabled()).toBe(false);
    expect(vibrate("added")).toBe(false);
    expect(vibrateApi).not.toHaveBeenCalled();
  });

  it("le réglage : couper écrit « off », rallumer efface la clé (le défaut redevient actif)", () => {
    const store = stubBrowser({ vibrate: vi.fn(() => true) });
    setHapticsEnabled(false);
    expect(store.get(HAPTICS_STORAGE_KEY)).toBe("off");
    setHapticsEnabled(true);
    expect(store.has(HAPTICS_STORAGE_KEY)).toBe(false);
    expect(isHapticsEnabled()).toBe(true);
  });

  it("chaque statut a un motif court et distinct", () => {
    const patterns = Object.values(HAPTIC_PATTERNS).map((pattern) => pattern.join("-"));
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const pattern of Object.values(HAPTIC_PATTERNS)) {
      expect(pattern.reduce((total, ms) => total + ms, 0)).toBeLessThanOrEqual(300);
    }
  });
});
