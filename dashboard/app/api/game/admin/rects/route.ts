import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/gameSession";
import { withCors, corsPreflight } from "@/lib/gameCors";
import { applyPayloadViaGitHub, type RectPayload } from "@/lib/gameRects";

export async function OPTIONS() {
  return corsPreflight();
}

// Distincte de ALLOWED_DISCORD_IDS (accès au panneau admin, next-auth) : mêmes personnes
// aujourd'hui (toi + le fonda), mais une liste dédiée exprès — même séparation de portée que
// GAME_SESSION_SECRET vis-à-vis de NEXTAUTH_SECRET. Un souci sur l'une des deux n'élargit pas
// l'autre.
const adminIds = (process.env.GAME_RECTS_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isValidPayload(body: unknown): body is RectPayload {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  const target = candidate.target as Record<string, unknown> | undefined;
  return (
    !!target &&
    (target.kind === "location" || target.kind === "map") &&
    typeof target.id === "string" &&
    Array.isArray(candidate.rects) &&
    Array.isArray(candidate.deleted)
  );
}

/**
 * Reçoit le payload posté par `RectEditor.save()` (jeu MYRHAVEN, éditeur F2, touche S hors dev)
 * et l'applique directement sur le repo du jeu via l'API GitHub (`lib/gameRects.ts`) — le
 * pendant "en prod" de `dev/rect-writer.ts` (serveur Vite local, dev uniquement) et de
 * `scripts/apply-rects.mjs` (collé à la main à Claude Code, méthode précédente).
 *
 * Double vérification avant d'écrire quoi que ce soit : `sessionFromRequest` authentifie le
 * token (signé côté serveur, jamais un simple champ décodé côté client), et `adminIds` restreint
 * l'action à toi/le fonda même parmi les joueurs connectés.
 */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session || !adminIds.includes(session.discordId)) {
    return withCors(NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }));
  }

  const body = await req.json().catch(() => null);
  if (!isValidPayload(body)) {
    return withCors(NextResponse.json({ ok: false, error: "payload invalide" }, { status: 400 }));
  }

  try {
    const result = await applyPayloadViaGitHub(body);
    return withCors(NextResponse.json({ ok: true, ...result }));
  } catch (error) {
    return withCors(NextResponse.json({ ok: false, error: String(error) }, { status: 500 }));
  }
}
