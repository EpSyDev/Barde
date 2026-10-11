// Rôles d'accès au dashboard / à la table de jeu.
//  - ALLOWED_DISCORD_IDS (env)  → toujours admin (accès de secours, non retirable depuis l'UI) ;
//  - module « acces » du bot    → liste éditable depuis le dashboard (admin | mj | joueur).
// Compatible edge (utilisé par le middleware) : uniquement fetch + variables d'env.
import { fripouilleFetch } from "@/lib/fripouille";

export type Role = "admin" | "mj" | "joueur";

const ENV_ADMINS = (process.env.ALLOWED_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TTL_MS = 30_000;
let cache: { at: number; map: Map<string, Role> } | null = null;

async function charger(): Promise<Map<string, Role> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const res = await fripouilleFetch("/api/config/acces");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { membres?: { id: string; role: Role }[] };
    const map = new Map<string, Role>();
    for (const m of data.membres || []) map.set(String(m.id), m.role);
    cache = { at: Date.now(), map };
    return map;
  } catch {
    // Bot injoignable : on garde la dernière liste connue (même périmée), sinon on ferme.
    return cache ? cache.map : null;
  }
}

/** Invalide le cache local (après modification de la liste depuis le dashboard). */
export function oublierCacheAcces() {
  cache = null;
}

/** Rôle d'un identifiant Discord, ou null s'il n'a aucun accès. */
export async function roleOf(discordId: string | undefined | null): Promise<Role | null> {
  const id = String(discordId || "");
  if (!id) return null;
  if (ENV_ADMINS.includes(id)) return "admin";
  const map = await charger();
  return map?.get(id) ?? null;
}

export const ADMINS_ENV = ENV_ADMINS;
