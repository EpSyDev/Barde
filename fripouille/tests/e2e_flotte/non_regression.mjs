// Non-régression du dashboard : les pages existantes se chargent toujours (admin), un
// convive reste cantonné à /ombres et /flotte, un intrus est refusé par le bot.
import { BASE, capitaine, etape, navigateur, session } from "./commun.mjs";

const erreurs = [];
const navig = await navigateur();
const admin = await capitaine(navig, "100000000000000007", "Gaspard", { width: 1280, height: 800 }, erreurs);
for (const page of ["/", "/ombres", "/table", "/flotte"]) {
  const r = await admin.goto(`${BASE}${page}`);
  if (!r || r.status() >= 400) throw new Error(`${page} : HTTP ${r?.status()}`);
  await admin.waitForTimeout(1500);
  etape(`admin ${page} : HTTP ${r.status()}, ${new URL(admin.url()).pathname}`);
}
const convive = await capitaine(navig, "100000000000000008", "Hélène", { width: 1280, height: 800 }, erreurs);
await convive.goto(`${BASE}/`);
if (new URL(convive.url()).pathname !== "/ombres") throw new Error("le convive n'est pas renvoyé vers /ombres");
await convive.goto(`${BASE}/flotte`);
if (new URL(convive.url()).pathname !== "/flotte") throw new Error("le convive n'accède pas à /flotte");
etape("convive : panneau → /ombres, /flotte accessible");
const r = await fetch(`${BASE}/api/flotte/ticket`, { method: "POST", headers: { cookie: `authjs.session-token=${await session("100000000000000009", "Intrus")}` } });
if (r.status !== 403) throw new Error(`intrus : HTTP ${r.status} au lieu de 403`);
etape("non-membre du serveur : ticket refusé (403)");
const anonyme = await fetch(`${BASE}/api/flotte/ticket`, { method: "POST" });
if (anonyme.status !== 401) throw new Error(`sans session : HTTP ${anonyme.status}`);
etape("sans session : 401");
await navig.close();
if (erreurs.length) { console.error("Erreurs JavaScript :\n" + erreurs.join("\n")); process.exit(1); }
