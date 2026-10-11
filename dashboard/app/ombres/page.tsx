import { redirect } from "next/navigation";
import { auth } from "@/auth";
import OmbresClient from "@/components/ombres/OmbresClient";
import "./ombres.css";

export const metadata = { title: "Les Ombres de la Taverne" };

// Le jeu de déduction de la taverne. Ouvert à tout membre du serveur (rôle « convive » à
// défaut d'un rôle d'accès) : la connexion Discord suffit, le bot vérifie l'appartenance.
export default async function OmbresPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/ombres");
  return <OmbresClient />;
}
