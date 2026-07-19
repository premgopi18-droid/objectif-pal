import { LogoutButton } from "@/components/logout-button";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le profil : qui est connecté, la déconnexion, et l'attribution des données —
 * GCD et Metron sont en CC BY-SA 4.0, les créditer est une OBLIGATION de
 * licence (specs §6), pas une politesse.
 */
export default async function ProfilPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).single()
    : { data: null };

  return (
    <section className="flex flex-col gap-8 py-6">
      <div>
        <h1 className="text-2xl font-bold">Profil</h1>
        <p className="mt-3 text-sm">
          Connecté en tant que <strong>{profile?.display_name ?? user?.email ?? "lecteur"}</strong>
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Mes données</h2>
        <p className="text-sm opacity-70">
          Tout ce que l&apos;app sait — livres, lectures avec notes et avis, journal des changements d&apos;état,
          achats, y compris ce que tu as supprimé. Tes données sont à toi.
        </p>
        <a
          href="/api/export"
          download
          className="w-fit rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-black"
        >
          Exporter tout (JSON)
        </a>
        <p className="text-xs opacity-60">
          Ou en CSV, table par table :{" "}
          {(["books", "readings", "reading_events", "purchases"] as const).map((table, index) => (
            <span key={table}>
              {index > 0 && " · "}
              <a href={`/api/export?format=csv&table=${table}`} download className="underline">
                {{ books: "livres", readings: "lectures", reading_events: "événements", purchases: "achats" }[table]}
              </a>
            </span>
          ))}
        </p>
      </section>

      <LogoutButton />

      <footer className="mt-auto border-t border-foreground/10 pt-4 text-xs opacity-70">
        <p>
          Données bibliographiques :{" "}
          <a href="https://www.comics.org" className="underline" rel="noopener noreferrer" target="_blank">
            Grand Comics Database™ (GCD)
          </a>{" "}
          et{" "}
          <a href="https://metron.cloud" className="underline" rel="noopener noreferrer" target="_blank">
            Metron
          </a>
          , sous licence{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            CC BY-SA 4.0
          </a>
          . Identification des ouvrages français et couvertures (récupérées le jour du scan) :{" "}
          <a href="https://api.bnf.fr" className="underline" rel="noopener noreferrer" target="_blank">
            catalogue général de la BnF
          </a>
          .
        </p>
      </footer>
    </section>
  );
}
