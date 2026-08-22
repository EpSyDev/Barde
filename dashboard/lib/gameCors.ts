// CORS pour les routes /api/game/* uniquement — le jeu MYRHAVEN tourne sur une
// origine distincte du dashboard. Les routes admin (même origine) n'en ont pas besoin.
import { NextResponse } from "next/server";

const GAME_ORIGIN = process.env.GAME_ORIGIN || "";

function headers(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": GAME_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function withCors(res: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(headers())) res.headers.set(key, value);
  return res;
}

export function corsPreflight(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}
