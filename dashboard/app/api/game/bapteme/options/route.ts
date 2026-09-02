import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Catalogue des choix du baptême (races, genres, origines, tempéraments, fois, polices) —
// le jeu peuple ses menus RP avec, sans dupliquer le lexique. Lecture pure, mais gardée
// derrière une session joueur comme le reste de /api/game/*.
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  try {
    const res = await fripouilleFetch("/api/action/bapteme/options", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
