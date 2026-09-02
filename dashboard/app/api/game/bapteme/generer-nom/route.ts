import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Tire un nom depuis les quatre axes phonétiques (race / genre / origine / tempérament) —
// le bouton « relancer » du rite à la chapelle. Le bot valide les clés et fait le tirage ;
// aucun nom n'est composé côté client.
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return withCors(NextResponse.json({ error: "corps JSON attendu" }, { status: 400 }));
  }
  const { race, gender, origin, trait } = body as Record<string, unknown>;

  try {
    const res = await fripouilleFetch("/api/action/bapteme/generer_nom", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId, race, gender, origin, trait }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
