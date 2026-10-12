// Vitrine visuelle : entraînement sous la météo imposée au banc (BANC_METEO), captures
// prises pendant les résolutions. À lancer avec l'API du banc démarrée sur cette météo.
import { BASE, SORTIE, capitaine, etape, navigateur } from "./commun.mjs";

const NOM = process.env.BANC_METEO || "meteo";
const erreurs = [];
const navig = await navigateur();
const A = await capitaine(navig, "100000000000000005", "Émile", { width: 1440, height: 900 }, erreurs);
await A.goto(`${BASE}/flotte`);
await A.getByRole("button", { name: "S'entraîner contre des bots" }).click();
await A.getByText("Capitaine Sel-de-Roche").waitFor();
await A.getByRole("button", { name: "Lever l'ancre" }).click();
await A.getByText("Donne tes ordres").waitFor({ timeout: 20000 });
await A.waitForTimeout(1500);
await A.screenshot({ path: `${SORTIE}/${NOM}-planification.png` });
for (let tour = 0; tour < 5; tour++) {
  await A.getByText("Donne tes ordres").waitFor({ timeout: 20000 });
  for (const d of ["Digit1", "Digit2", "Digit3", "Digit4"]) {
    await A.keyboard.press(d);
    for (const k of ["d", "x", "e"]) await A.keyboard.press(k);
  }
  await A.keyboard.press("Escape");
  await A.getByRole("button", { name: /Verrouiller mes ordres/ }).click().catch(() => {});
  await A.getByText("Feu à volonté !").waitFor({ timeout: 15000 });
  await A.waitForTimeout(1400);
  if (tour >= 2) await A.screenshot({ path: `${SORTIE}/${NOM}-combat-${tour - 1}.png` });
}
etape(`captures « ${NOM} » faites`);
await A.getByRole("button", { name: "Quitter la partie" }).click();
await A.getByRole("button", { name: "Abandonner" }).click();
await navig.close();
if (erreurs.length) { console.error("Erreurs JavaScript :\n" + erreurs.join("\n")); process.exit(1); }
