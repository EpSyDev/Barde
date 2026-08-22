import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { fripouilleFetch } from "@/lib/fripouille";
import { withCors, corsPreflight } from "@/lib/gameCors";

export async function OPTIONS() {
  return corsPreflight();
}

// Le prix n'est JAMAIS pris dans le corps de la requête : seul `item_id` est
// transmis, le bot résout le prix depuis son catalogue `boutique` (même source
// que la boutique Discord) et débite atomiquement.
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  const body = await req.json().catch(() => null);
  const itemId = body && typeof body.item_id === "string" ? body.item_id : "";
  if (!itemId) return withCors(NextResponse.json({ error: "item_id requis" }, { status: 400 }));

  try {
    const res = await fripouilleFetch("/api/action/economie/acheter", {
      method: "POST",
      body: JSON.stringify({ user_id: session.discordId, item_id: itemId }),
    });
    const data = await res.json().catch(() => ({}));
    return withCors(NextResponse.json(data, { status: res.status }));
  } catch {
    return withCors(NextResponse.json({ error: "bot injoignable" }, { status: 502 }));
  }
}
