// Proxy serveur vers le bot « La Fripouille » (features communauté, port 8081).
// Token jamais exposé au navigateur. Base distincte du bot musique (api.ts).
const BASE = process.env.FRIPOUILLE_API_BASE_URL || "";
const TOKEN = process.env.FRIPOUILLE_API_TOKEN || process.env.API_TOKEN || "";

export async function fripouilleFetch(path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "X-Api-Token": TOKEN,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
}
