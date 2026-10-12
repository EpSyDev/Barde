import { redirect } from "next/navigation";
import { auth } from "@/auth";
import FlotteClient from "@/components/flotte/FlotteClient";
import "./flotte.css";

export const metadata = { title: "Guerre des Flottes Royales" };

// Bataille navale de la taverne. Ouverte à tout membre du serveur (rôle « convive » à défaut
// d'un rôle d'accès) : la connexion Discord suffit, La Fripouille vérifie l'appartenance.
export default async function FlottePage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/flotte");
  return <FlotteClient />;
}
