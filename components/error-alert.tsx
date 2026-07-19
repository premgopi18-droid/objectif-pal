/**
 * L'alerte d'erreur — le même bandeau rouge partout, `role="alert"` pour que
 * les lecteurs d'écran l'annoncent dès son apparition.
 */
export function ErrorAlert({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-red/40 bg-red/10 p-3 text-sm text-red">
      {message}
    </p>
  );
}
