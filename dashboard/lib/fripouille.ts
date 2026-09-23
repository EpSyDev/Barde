// Proxy serveur vers le bot « La Fripouille » (features communauté, port 8081).
// Token jamais exposé au navigateur. Base distincte du bot musique (api.ts).
const BASE = process.env.FRIPOUILLE_API_BASE_URL || "";
const TOKEN = process.env.FRIPOUILLE_API_TOKEN || process.env.API_TOKEN || "";

type Options = RequestInit & {
  /** Tavernier à l'origine de l'appel : tracé dans l'audit du bot (en-tête X-Actor).
   *  Purement informatif — l'autorisation, elle, tient au token et à la liste blanche. */
  actor?: string;
};

export async function fripouilleFetch(path: string, init?: Options) {
  const { actor, ...rest } = init || {};
  return fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(rest.headers || {}),
      "X-Api-Token": TOKEN,
      "Content-Type": "application/json",
      ...(actor ? { "X-Actor": actor } : {}),
    },
    cache: "no-store",
  });
}

/** Nom lisible du tavernier connecté, pour l'audit. */
export function actorFrom(session: unknown): string {
  const user = (session as { user?: { name?: string; discordId?: string } })?.user;
  if (!user) return "inconnu";
  return user.discordId ? `${user.name || "?"} (${user.discordId})` : user.name || "inconnu";
}
