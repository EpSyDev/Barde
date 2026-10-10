import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PisteDesClient from "@/components/table/PisteDesClient";

export const metadata = { title: "Piste de dés — La Taverne du Gaming" };

// Prototype : réservé aux taverniers connectés tant que l'espace membre n'existe pas.
export default async function TablePage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <PisteDesClient />;
}
