import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PlateauClient from "@/components/table/PlateauClient";

export const metadata = { title: "Table de jeu — La Taverne du Gaming" };

// Table de jeu D&D : plateau + dés 3D + initiative + carnet du MJ, sur une seule page.
// Adresse à donner aux joueurs (accès réglé dans l'onglet « Accès » du panneau).
export default async function TablePage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/table");
  return <PlateauClient />;
}
