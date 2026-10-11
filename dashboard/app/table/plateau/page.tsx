import { redirect } from "next/navigation";

// Ancienne adresse du plateau : la table de jeu vit désormais sur /table.
export default function PlateauPage() {
  redirect("/table");
}
