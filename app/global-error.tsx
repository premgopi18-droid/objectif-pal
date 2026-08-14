"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Le filet des erreurs de rendu React (issue #181) : global-error REMPLACE le
 * layout racine quand tout a cassé — il porte donc ses propres html/body et
 * des styles inline (les tokens CSS de l'app ne sont plus garantis ici).
 * L'erreur part à Sentry ; l'utilisateur garde un bouton pour repartir.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          background: "#2e2357",
          color: "#eceaf6",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <p style={{ fontSize: "2.5rem", margin: 0 }} aria-hidden>
          📚💥
        </p>
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Quelque chose a cassé.</h1>
        <p style={{ margin: 0, opacity: 0.8, maxWidth: "28rem" }}>
          L&apos;erreur est signalée — tes données, elles, sont en sécurité.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.4rem",
            borderRadius: "999px",
            border: "none",
            background: "#a493ff",
            color: "#1c1830",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
