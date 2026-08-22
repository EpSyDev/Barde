import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Le montant n'est JAMAIS pris dans le corps de la requête : seul `event_id` est
// transmis, le bot résout lui-même le montant depuis son catalogue `evenements`
// et applique l'anti-rejeu (une fois par joueur et par événement).
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  const body = await req.json().catch(() => null);
  const eventId = body && typeof body.event_id === "string" ? body.event_id : "";
  if (!eventId) return withCors(NextResponse.json({ error: "event_id requis" }, { status: 400 }));

  try {
    const res = await fripouilleFetch("/api/action/economie/crediter_evenement", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId, event_id: eventId }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
