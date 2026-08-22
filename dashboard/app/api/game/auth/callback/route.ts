import { NextRequest, NextResponse } from "next/server";
import { createGameToken, verifyState } from "@/lib/gameSession";

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";

function callbackUrl(req: NextRequest): string {
  return new URL("/api/game/auth/callback", req.nextUrl.origin).toString();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const returnTo = verifyState(req.nextUrl.searchParams.get("state") || "");
  if (!code || !returnTo) {
    return NextResponse.json({ error: "requête OAuth invalide ou expirée" }, { status: 400 });
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(req),
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "échange OAuth échoué" }, { status: 502 });
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) {
    return NextResponse.json({ error: "échange OAuth échoué" }, { status: 502 });
  }

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    return NextResponse.json({ error: "profil Discord illisible" }, { status: 502 });
  }
  const me = (await meRes.json()) as { id: string; username: string };

  const token = createGameToken(me.id, me.username);
  const redirectTo = new URL(returnTo);
  redirectTo.hash = `token=${token}`;
  return NextResponse.redirect(redirectTo.toString());
}
