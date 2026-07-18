/**
 * La section d'erreur commune aux pages de données (bilan, journal, PAL) :
 * quand la requête serveur échoue, on garde le titre de la page et on affiche
 * un message d'alerte invitant à réessayer. Composant serveur, sans état.
 */
type PageLoadErrorProps = {
  /** Le titre de la page, conservé pour ne pas dérouter (« Journal », « Ma PAL »…). */
  title: string;
  /** Le message d'alerte complet (« Impossible de charger le bilan — réessaie. »). */
  message: string;
};

export function PageLoadError({ title, message }: PageLoadErrorProps) {
  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p role="alert" className="mt-3 text-sm text-red-500">
        {message}
      </p>
    </section>
  );
}
