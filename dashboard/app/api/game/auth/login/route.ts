import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/lib/gameSession";

// Flux OAuth du JEU (public, pas de whitelist) — distinct de l'auth admin (auth.ts).
const GAME_ORIGIN = process.env.GAME_ORIGIN || "";
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";

function callbackUrl(req: NextRequest): string {
  return new URL("/api/game/auth/callback", req.nextUrl.origin).toString();
}

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get("return_to") || "";
  // Comparaison d'origine stricte (pas `startsWith` : "https://GAME_ORIGIN.evil.com"
  // passerait un simple préfixe) — anti open-redirect.
  let returnOrigin: string | null = null;
  try {
    returnOrigin = new URL(returnTo).origin;
  } catch {
    returnOrigin = null;
  }
  if (!GAME_ORIGIN || returnOrigin !== new URL(GAME_ORIGIN).origin) {
    return NextResponse.json({ error: "return_to invalide" }, { status: 400 });
  }

  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callbackUrl(req));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", signState(returnTo));
  return NextResponse.redirect(authorize.toString());
}
