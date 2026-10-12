// Mesure : images par seconde de la carte, 8 flottes, en haute puis basse qualité.
import { BASE, capitaine, etape, navigateur } from "./commun.mjs";

const navig = await navigateur();
const A = await capitaine(navig, "100000000000000006", "Fanny");
await A.goto(`${BASE}/flotte`);
await A.getByRole("button", { name: "S'entraîner contre des bots" }).click();
await A.getByText("Capitaine Sel-de-Roche").waitFor();
for (let i = 0; i < 5; i++) await A.getByRole("button", { name: "+ Ajouter un bot d'entraînement" }).click();
await A.getByText("Corsaire Lanterne").waitFor();
await A.getByRole("button", { name: "Lever l'ancre" }).click();
await A.getByText("Donne tes ordres").waitFor({ timeout: 20000 });
const mesure = () => A.evaluate(() => new Promise((ok) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else ok(Math.round(n / 3)); };
  requestAnimationFrame(f);
}));
etape(`haute qualité : ${await mesure()} images/s`);
await A.evaluate(() => localStorage.setItem("flotte:reglages", JSON.stringify({ qualite: "basse" })));
await A.reload();
await A.getByText("Donne tes ordres").waitFor({ timeout: 20000 });
etape(`basse qualité : ${await mesure()} images/s (le rendu n'en dessine qu'une sur deux)`);
await A.evaluate(() => localStorage.removeItem("flotte:reglages"));
await A.getByRole("button", { name: "Quitter la partie" }).click();
await A.getByRole("button", { name: "Abandonner" }).click();
await navig.close();
