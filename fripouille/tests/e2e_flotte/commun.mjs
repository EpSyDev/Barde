// Outils partagés des scénarios : cookie de session Auth.js forgé (secret du banc), navigateur.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
export const RACINE = resolve(ICI, "../../..");
export const BASE = process.env.BANC_URL || "http://localhost:3077";
export const SORTIE = process.env.BANC_SORTIE || resolve(ICI, "captures");
export const SECRET = "secret-banc-0123456789abcdef0123456789";
const require = createRequire(import.meta.url);

/** Playwright : celui de PW (chemin), sinon celui résolu depuis le dashboard ou le global. */
function playwright() {
  for (const p of [process.env.PW, "playwright", resolve(RACINE, "dashboard/node_modules/playwright")].filter(Boolean)) {
    try { return require(p); } catch { /* suivant */ }
  }
  throw new Error("Playwright introuvable : npm i -g playwright, ou PW=/chemin/vers/playwright");
}

export async function navigateur() {
  const { chromium } = playwright();
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

export async function session(uid, nom) {
  const { encode } = await import(resolve(RACINE, "dashboard/node_modules/next-auth/jwt.js"));
  return encode({ token: { name: nom, sub: uid, discordId: uid, picture: null }, secret: SECRET, salt: "authjs.session-token" });
}

/** Un capitaine = un contexte de navigateur isolé, connecté avec son compte. */
export async function capitaine(navig, uid, nom, viewport = { width: 1440, height: 900 }, erreurs = []) {
  const ctx = await navig.newContext({ viewport });
  await ctx.addCookies([{ name: "authjs.session-token", value: await session(uid, nom), domain: new URL(BASE).hostname, path: "/" }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${nom}: ${e.message}`));
  return p;
}

export const etape = (t) => console.log("  ✓", t);
