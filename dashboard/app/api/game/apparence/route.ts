import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Apparence du personnage de la Taverne 3D, conservée par le bot (suit le joueur d'un
// appareil à l'autre). Le bot borne chaque champ et impose la race du baptême.
async function relay(action: string, payload: Record<string, unknown>) {
  try {
    const res = await fripouilleFetch(`/api/action/bapteme/${action}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}

export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  return relay("apparence", { user_id: session.discordId });
}

export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || JSON.stringify(body).length > 1024) {
    return withCors(NextResponse.json({ error: "corps JSON attendu" }, { status: 400 }));
  }
  return relay("apparence_enregistrer", { user_id: session.discordId, look: (body as { look?: unknown }).look });
}
