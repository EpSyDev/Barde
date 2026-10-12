// Entraînement contre deux bots, joué jusqu'à l'écran de fin, puis revanche.
import { BASE, SORTIE, capitaine, etape, navigateur } from "./commun.mjs";

const erreurs = [];
const navig = await navigateur();
const A = await capitaine(navig, "100000000000000004", "Dalia", { width: 1440, height: 900 }, erreurs);
await A.goto(`${BASE}/flotte`);
await A.getByRole("button", { name: "S'entraîner contre des bots" }).click();
await A.getByRole("heading", { name: "Le port s'anime" }).waitFor();
await A.getByText("Capitaine Sel-de-Roche").waitFor();
const curseur = A.locator('input[type="range"]').first();
await curseur.focus();
for (let i = 0; i < 20; i++) await curseur.press("ArrowLeft");
await A.getByText("Manches maximum 8").waitFor();
await A.waitForTimeout(800);
await A.getByRole("button", { name: "Lever l'ancre" }).click();
etape("entraînement lancé (8 manches, 2 bots)");
let tours = 0;
while (!(await A.locator(".fl-fin").count())) {
  if (await A.getByText("Donne tes ordres").count()) {
    await A.getByRole("button", { name: /Verrouiller mes ordres/ }).click().catch(() => {});
    tours++;
  }
  await A.waitForTimeout(700);
  if (tours > 30) throw new Error("la partie ne finit pas");
}
await A.getByRole("dialog").waitFor();
await A.screenshot({ path: `${SORTIE}/fin.png` });
etape(`écran de fin : « ${(await A.locator("#fl-fin-titre").textContent()).trim()} »`);
await A.getByRole("button", { name: "Voir la carte" }).click();
await A.getByRole("button", { name: "Voir le classement" }).click();
await A.getByRole("button", { name: "Revanche, même carte" }).click();
await A.getByRole("heading", { name: "Le port s'anime" }).waitFor();
etape("revanche : retour au salon");
await A.getByRole("button", { name: "Quitter le salon" }).click();
await A.getByRole("heading", { name: "Guerre des Flottes Royales" }).waitFor();
await navig.close();
if (erreurs.length) { console.error("Erreurs JavaScript :\n" + erreurs.join("\n")); process.exit(1); }
