// Session joueur pour le jeu MYRHAVEN — séparée de l'auth admin (auth.ts) : la
// liste blanche ALLOWED_DISCORD_IDS ne doit jamais être touchée par ce chemin public.
// Jeton compact signé (HMAC), pas de dépendance JWT ajoutée pour ça.
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.GAME_SESSION_SECRET || "";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const STATE_TTL_MS = 5 * 60 * 1000; // 5 min — juste le temps de l'aller-retour OAuth

export interface GameSession {
  discordId: string;
  username: string;
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function pack(data: unknown): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function unpack(token: string): unknown | null {
  if (!SECRET) return null;
  const [payload, signature] = (token || "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function createGameToken(discordId: string, username: string): string {
  return pack({ sub: discordId, username, exp: Date.now() + SESSION_TTL_MS });
}

export function verifyGameToken(token: string): GameSession | null {
  const data = unpack(token) as { sub?: unknown; username?: unknown; exp?: unknown } | null;
  if (!data || typeof data.sub !== "string" || typeof data.exp !== "number" || data.exp < Date.now()) {
    return null;
  }
  return { discordId: data.sub, username: typeof data.username === "string" ? data.username : "" };
}

/** Lit et vérifie le `Authorization: Bearer <token>` d'une requête du jeu. */
export function sessionFromRequest(req: Request): GameSession | null {
  const [scheme, token] = (req.headers.get("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return verifyGameToken(token);
}

/** Protège `return_to` pendant l'aller-retour OAuth (anti-CSRF / anti open-redirect). */
export function signState(returnTo: string): string {
  return pack({ returnTo, exp: Date.now() + STATE_TTL_MS });
}

export function verifyState(state: string): string | null {
  const data = unpack(state) as { returnTo?: unknown; exp?: unknown } | null;
  if (!data || typeof data.returnTo !== "string" || typeof data.exp !== "number" || data.exp < Date.now()) {
    return null;
  }
  return data.returnTo;
}
