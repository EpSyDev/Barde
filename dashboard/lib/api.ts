// Appels côté serveur uniquement : le token n'atteint jamais le navigateur.
const BASE = process.env.API_BASE_URL || "";
const TOKEN = process.env.API_TOKEN || "";

export async function apiFetch(path: string, init?: RequestInit) {
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
