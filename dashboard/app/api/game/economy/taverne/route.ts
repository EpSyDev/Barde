import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Carte de Brom (Taverne 3D) : articles marqués « taverne » au dashboard + devise + solde du joueur.
// L'achat passe par /api/game/economy/acheter (prix résolu côté bot).
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  try {
    const res = await fripouilleFetch("/api/action/economie/taverne", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
