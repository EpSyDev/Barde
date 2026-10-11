import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PisteDesClient from "@/components/table/PisteDesClient";

export const metadata = { title: "Piste de dés — La Taverne du Gaming" };

// Ancienne piste de dés seule (la table de jeu l'intègre désormais) : gardée en secours.
export default async function PistePage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/table/piste");
  return <PisteDesClient />;
}
