import { signIn } from "@/auth";

// callbackUrl : retour à la page demandée (ex. /table pour les joueurs). Chemin interne
// uniquement — jamais une URL externe (pas de redirection ouverte).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const retour = callbackUrl && /^\/(?!\/)[\w\-/?=&.]*$/.test(callbackUrl) ? callbackUrl : "/";
  const table = retour.startsWith("/table");
  const ombres = retour.startsWith("/ombres");
  const flotte = retour.startsWith("/flotte");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>La Taverne de Gaming</h1>
        <p>
          {ombres
            ? "Les Ombres de la Taverne t'attendent : entre avec ton compte Discord du serveur."
            : flotte
              ? "Ta flotte attend son capitaine : embarque avec ton compte Discord du serveur."
              : table
                ? "La table de jeu t'attend : connecte-toi avec ton compte Discord."
                : "Seuls les maîtres des lieux peuvent commander les bardes."}
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: retour });
          }}
        >
          <button type="submit" className="discord-btn">
            Entrer avec Discord
          </button>
        </form>
      </div>
    </div>
  );
}
