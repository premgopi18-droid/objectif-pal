"use client";

import { useEffect, useState } from "react";
import { isHapticsEnabled, setHapticsEnabled } from "@/lib/scan/haptics";

/**
 * Le réglage « Vibrations » de la rafale (fluidité #332, item 8). Lu en effet
 * (le serveur ne connaît pas localStorage — un état initial divergent
 * casserait l'hydratation), défaut actif. Le contrôle n'apparaît que si
 * l'appareil sait vibrer : sur iPhone, `navigator.vibrate` n'existe pas, un
 * interrupteur sans effet mentirait.
 */
export function HapticsToggle({ labelClassName }: { labelClassName: string }) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    // Un seul re-rendu au montage, sur des faits que seul le navigateur connaît.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof navigator !== "undefined" && typeof navigator.vibrate === "function");
    setEnabled(isHapticsEnabled());
  }, []);

  if (!supported) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className={labelClassName}>Scan</h2>
      <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-line bg-card2 px-4 py-3">
        <span className="text-sm text-ink">
          <span className="font-bold">Vibrations en rafale</span>
          <span className="block text-xs text-ink3">Une secousse à chaque livre lu, une autre selon ce qu&apos;il devient.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setHapticsEnabled(event.target.checked);
          }}
          className="size-5 shrink-0 accent-cyan"
        />
      </label>
    </section>
  );
}
