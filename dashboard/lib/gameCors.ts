// CORS pour les routes /api/game/* uniquement — le jeu MYRHAVEN tourne sur une
// origine distincte du dashboard. Les routes admin (même origine) n'en ont pas besoin.
import { NextResponse } from "next/server";

const GAME_ORIGIN = process.env.GAME_ORIGIN || "";

if (!GAME_ORIGIN) {
  // Var d'env absente ou pas prise en compte (Environment pas coché / pas redéployé
  // depuis l'ajout) — sans ça le CORS échoue silencieusement côté navigateur.
  console.warn("GAME_ORIGIN n'est pas défini : les routes /api/game/* refuseront le jeu en CORS.");
}

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
