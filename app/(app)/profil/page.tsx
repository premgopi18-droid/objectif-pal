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
          . Identification des ouvrages français : catalogue général de la BnF.
        </p>
      </footer>
    </section>
  );
}
