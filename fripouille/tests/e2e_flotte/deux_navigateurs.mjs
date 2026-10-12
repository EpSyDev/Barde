// Deux navigateurs, deux comptes Discord (ordinateur + téléphone) : une vraie partie à travers
// le serveur — salon par code, prêt, lancement, ordres au clavier, verrou, résolution par le
// serveur, rechargement en pleine partie, abandon confirmé.
import { BASE, SORTIE, capitaine, etape, navigateur } from "./commun.mjs";

const erreurs = [];
const navig = await navigateur();
const A = await capitaine(navig, "100000000000000001", "Anne", { width: 1440, height: 900 }, erreurs);
const B = await capitaine(navig, "100000000000000002", "Bastien", { width: 390, height: 844 }, erreurs);

await A.goto(`${BASE}/flotte`);
await A.getByRole("heading", { name: "Guerre des Flottes Royales" }).waitFor();
await A.screenshot({ path: `${SORTIE}/quai.png` });
await A.getByRole("button", { name: "Hisser les voiles" }).click();
await A.getByRole("heading", { name: "Le port s'anime" }).waitFor();
const code = (await A.locator(".fl-code-btn strong").textContent()).trim();
etape(`salon créé, code ${code}`);

await B.goto(`${BASE}/flotte`);
await B.getByText("Flotte de Anne de Brisevague").waitFor();      // le quai public se met à jour
await B.locator("#fl-code").fill(code.toLowerCase());
await B.getByRole("button", { name: "Embarquer" }).click();
await B.getByRole("heading", { name: "Le port s'anime" }).waitFor();
etape("Bastien a rejoint par le code (téléphone 390 px)");
await B.getByRole("radio", { name: /Dragon/ }).click();
await B.getByRole("button", { name: "Je suis prêt" }).click();
await A.getByRole("button", { name: "+ Ajouter un bot d'entraînement" }).click();
await A.getByText("Bastien Tribord").waitFor();
await A.screenshot({ path: `${SORTIE}/salon.png` });
await A.waitForFunction(() => !document.querySelector(".fl-salon-pied .fl-btn-principal")?.disabled);
await A.getByRole("button", { name: "Lever l'ancre" }).click();
for (const p of [A, B]) await p.getByText("Donne tes ordres").waitFor({ timeout: 20000 });
etape("planification de la manche 1 des deux côtés");

await A.keyboard.press("Digit1");
for (const k of ["d", "e", "x", "a", "w", "z"]) {
  await A.keyboard.press(k);
  await A.waitForTimeout(150);
  if (await A.getByText(/Cap : 1 pas/).count()) break;
}
await A.getByText(/Cap : 1 pas/).first().waitFor();
etape("ordre de mouvement au clavier accepté par le serveur");
await A.screenshot({ path: `${SORTIE}/ordres.png` });
await A.getByRole("button", { name: /Verrouiller mes ordres/ }).click();
await A.getByRole("button", { name: /Ordres verrouillés/ }).waitFor();
await B.getByRole("button", { name: /^1/ }).first().click();
await B.getByRole("button", { name: /Verrouiller mes ordres/ }).click();
for (const p of [A, B]) await p.getByRole("heading", { name: "Manche 1" }).waitFor({ timeout: 15000 });
for (const p of [A, B]) await p.getByText("Donne tes ordres").waitFor({ timeout: 15000 });
etape(`manche résolue par le serveur, reçue des deux côtés (${(await A.locator(".fl-manche-num").textContent()).trim()})`);
await B.screenshot({ path: `${SORTIE}/telephone.png`, fullPage: true });

await B.reload();
await B.getByText("Donne tes ordres").waitFor({ timeout: 15000 });
etape("rechargement : Bastien retombe dans sa partie");
await B.getByRole("button", { name: "Quitter la partie" }).click();
await B.getByRole("button", { name: "Abandonner" }).click();
await B.getByRole("heading", { name: "Guerre des Flottes Royales" }).waitFor();
await A.getByRole("button", { name: "Quitter la partie" }).click();
await A.getByRole("button", { name: "Rester à la barre" }).click();
await A.getByRole("button", { name: "Quitter la partie" }).click();
await A.getByRole("button", { name: "Abandonner" }).click();
await A.getByRole("heading", { name: "Guerre des Flottes Royales" }).waitFor();
etape("abandons confirmés, retour au quai");
await navig.close();
if (erreurs.length) { console.error("Erreurs JavaScript :\n" + erreurs.join("\n")); process.exit(1); }
