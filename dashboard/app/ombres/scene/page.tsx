import OmbresClient from "@/components/ombres/OmbresClient";
import "../ombres.css";

export const metadata = { title: "Les Ombres de la Taverne — scène" };

// Vue de scène (stream / écran de salle) : publique, sans connexion, lecture seule. La clé
// est vérifiée par La Fripouille, qui ne renvoie que la vue publique (aucun rôle secret).
export default async function ScenePage({ searchParams }: { searchParams: Promise<{ cle?: string }> }) {
  const { cle } = await searchParams;
  const base = (process.env.FRIPOUILLE_API_BASE_URL || "").replace(/\/$/, "");
  const valide = cle && /^[\w-]{10,40}$/.test(cle);
  return <OmbresClient scene={valide ? `${base}/api/ombres/flux?scene=${cle}` : ""} />;
}
