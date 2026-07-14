"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker (coquille en cache, specs §4.9) — en
 * production seulement : en dev, un SW qui cache casse le rechargement à chaud.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Un SW qui ne s'enregistre pas ne doit jamais gêner l'app.
    });
  }, []);

  return null;
}
