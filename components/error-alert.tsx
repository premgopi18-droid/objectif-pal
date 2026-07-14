/**
 * L'alerte d'erreur — le même bandeau rouge partout, `role="alert"` pour que
 * les lecteurs d'écran l'annoncent dès son apparition.
 */
export function ErrorAlert({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">
      {message}
    </p>
  );
}
