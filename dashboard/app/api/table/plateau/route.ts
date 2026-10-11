import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch, actorFrom } from "@/lib/fripouille";

// Plateau de jeu : délivre au navigateur un ticket de soirée (12 h) pour se brancher
// DIRECTEMENT sur La Fripouille (flux temps réel + gestes) via le Funnel. Le token de
// l'API ne quitte jamais le serveur ; le ticket ne donne accès qu'au plateau.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // Le rôle (admin | mj | joueur) voyage dans le ticket : le plateau s'en servira pour les gestes de MJ.
    const role = (session.user as { role?: string } | undefined)?.role || "joueur";
    const res = await fripouilleFetch("/api/plateau/ticket", {
      method: "POST",
      body: JSON.stringify({ role }),
      actor: actorFrom(session),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("table/plateau", e);
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
