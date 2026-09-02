import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Baptise le joueur à la fin du rite de la chapelle (jeu MYRHAVEN). Le bot rejoue les
// mêmes effets que la validation du parcours Discord : pseudo stylisé, rôle de race +
// rôle de foi, bonus d'économie, message d'événement. Il valide toutes les clés et
// applique l'anti re-baptême — le client ne fait que transmettre les cinq axes choisis.
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return withCors(NextResponse.json({ error: "corps JSON attendu" }, { status: 400 }));
  }
  const { race, gender, origin, trait, faith, name, style } = body as Record<string, unknown>;

  try {
    const res = await fripouilleFetch("/api/action/bapteme/consacrer", {
      method: "POST",
      body: JSON.stringify({
        user_id: session.discordId,
        race,
        gender,
        origin,
        trait,
        faith,
        name,
        style,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
