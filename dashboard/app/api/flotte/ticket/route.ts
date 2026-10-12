import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fripouilleFetch, actorFrom } from "@/lib/fripouille";

// Guerre des Flottes Royales : ticket de capitaine pour se brancher DIRECTEMENT sur La
// Fripouille (flux temps réel + ordres). Le bot revérifie que le compte est membre du
// serveur et reprend son pseudo / avatar côté Discord ; le token d'API ne quitte jamais le serveur.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = session.user as { role?: string; discordId?: string; name?: string; image?: string } | undefined;
  try {
    const res = await fripouilleFetch("/api/flotte/ticket", {
      method: "POST",
      body: JSON.stringify({ role: u?.role || "convive", uid: u?.discordId || "", nom: u?.name || "", avatar: u?.image || "" }),
      actor: actorFrom(session),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("flotte/ticket", e);
    return NextResponse.json({ error: "bot injoignable" }, { status: 502 });
  }
}
