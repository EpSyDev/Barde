import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Première visite du jour dans la Taverne 3D : le bot applique le délai et le montant (gains.taverne_visite).
// Rien n'est pris dans le corps de la requête : seule la session identifie le joueur.
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  try {
    const res = await fripouilleFetch("/api/action/economie/visite_taverne", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
