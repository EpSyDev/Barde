import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PlateauClient from "@/components/table/PlateauClient";

export const metadata = { title: "Plateau de jeu — La Taverne du Gaming" };

// Prototype : réservé aux taverniers connectés tant que l'espace membre n'existe pas.
export default async function PlateauPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <PlateauClient />;
}
