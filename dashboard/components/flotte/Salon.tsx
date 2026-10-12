"use client";

// Salon d'attente : capitaines, pavillons, prêt / pas prêt, réglages de l'hôte, code à partager.
// Toutes les permissions sont revérifiées par le serveur ; ici on ne fait que les refléter.

import { useEffect, useRef, useState } from "react";
import { PAVILLONS, type PavillonId, type VueSalon } from "@/lib/flotte";
import { Pavillon } from "./Emblemes";
import type { Reponse } from "./useFlotte";

export default function Salon({ vue, op, surQuitter, surAide }: {
  vue: VueSalon;
  op: (c: Record<string, unknown>) => Promise<Reponse>;
  surQuitter: () => void;
  surAide: () => void;
}) {
  const [copie, setCopie] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [options, setOptions] = useState(vue.options);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!minuterie.current) setOptions(vue.options); }, [vue.options]);
  const moi = vue.joueurs.find((j) => j.uid === vue.moi) ?? null;
  const hote = vue.hote === vue.moi;
  const { regles } = vue;
  const pris = new Set(vue.joueurs.map((j) => j.pavillon));
  const attente = vue.joueurs.filter((j) => j.uid !== vue.hote && !j.pret);
  const peutLancer = vue.joueurs.length >= regles.min && !attente.length;

  const geste = async (c: Record<string, unknown>) => {
    const r = await op({ salon: vue.id, ...c });
    if (!r.ok) {
      setRefus(r.erreur || "Refusé.");
      setTimeout(() => setRefus(null), 4000);
    }
  };

  // Les curseurs n'envoient que la valeur finale (pas un geste par cran).
  const regler = (cle: "manches" | "plan", valeur: number) => {
    setOptions((o) => ({ ...o, [cle]: valeur }));
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => {
      minuterie.current = null;
      geste({ op: "regler", options: { [cle]: valeur } });
    }, 350);
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(vue.code);
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    } catch {
      setRefus(`Code : ${vue.code}`);
    }
  };

  return (
    <div className="fl-salon">
      <header className="fl-salon-tete">
        <div>
          <p className="fl-surtitre">Salon {vue.public ? "public" : "privé"}</p>
          <h1>Le port s'anime</h1>
          <p className="fl-doux">Choisis ton pavillon, puis déclare-toi prêt. L'hôte lève l'ancre quand tout le monde l'est.</p>
        </div>
        <div className="fl-code">
          <span>Code du salon</span>
          <button onClick={copier} className="fl-code-btn" aria-label={`Copier le code ${vue.code}`}>
            <strong>{vue.code}</strong>
            <em aria-live="polite">{copie ? "Copié !" : "Copier"}</em>
          </button>
        </div>
      </header>

      {refus && <p className="fl-refus" role="alert">{refus}</p>}

      <div className="fl-salon-grille">
        <section className="fl-carte-panneau">
          <h2>Capitaines <small>{vue.joueurs.length}/{regles.max}</small></h2>
          <ul className="fl-equipage">
            {vue.joueurs.map((j) => (
              <li key={j.uid} style={{ "--camp": PAVILLONS[j.pavillon].couleur } as React.CSSProperties}>
                <Pavillon id={j.pavillon} taille={40} titre />
                <div className="qui">
                  <strong>{j.nom}{j.uid === vue.moi ? " (toi)" : ""}</strong>
                  <small>
                    {PAVILLONS[j.pavillon].royaume}
                    {j.uid === vue.hote ? " · hôte" : ""}
                    {j.bot ? " · bot d'entraînement" : vue.connectes.includes(j.uid) ? "" : " · hors ligne"}
                  </small>
                </div>
                <span className={`etat${j.pret || j.uid === vue.hote ? " pret" : ""}`}>
                  {j.uid === vue.hote ? "À la barre" : j.pret ? "Prêt" : "Se prépare"}
                </span>
                {hote && j.uid !== vue.moi && (
                  <button className="fl-btn-icone" onClick={() => geste({ op: "retirer", uid: j.uid })} aria-label={`Retirer ${j.nom}`} title="Retirer">✕</button>
                )}
              </li>
            ))}
          </ul>
          {hote && vue.joueurs.length < regles.max && (
            <button className="fl-btn" onClick={() => geste({ op: "bot" })}>+ Ajouter un bot d'entraînement</button>
          )}
        </section>

        <section className="fl-carte-panneau">
          <h2>Ton pavillon</h2>
          <div className="fl-pavillons" role="radiogroup" aria-label="Choix du pavillon">
            {regles.pavillons.map((p: PavillonId) => {
              const mien = moi?.pavillon === p;
              return (
                <button key={p} role="radio" aria-checked={mien} disabled={!moi || (pris.has(p) && !mien)}
                  className={mien ? "actif" : ""} onClick={() => geste({ op: "pavillon", pavillon: p })}
                  title={`${PAVILLONS[p].nom} — ${PAVILLONS[p].royaume}`}>
                  <Pavillon id={p} taille={46} />
                  <span>{PAVILLONS[p].nom}</span>
                </button>
              );
            })}
          </div>

          <h2>Réglages de la bataille</h2>
          <div className="fl-reglages">
            <label>
              <span>Manches maximum <strong>{options.manches}</strong></span>
              <input type="range" min={regles.bornes.manches[0]} max={regles.bornes.manches[1]} step={1} disabled={!hote}
                value={options.manches} onChange={(e) => regler("manches", Number(e.target.value))} />
            </label>
            <label>
              <span>Temps pour donner ses ordres <strong>{options.plan} s</strong></span>
              <input type="range" min={regles.bornes.plan[0]} max={regles.bornes.plan[1]} step={10} disabled={!hote}
                value={options.plan} onChange={(e) => regler("plan", Number(e.target.value))} />
            </label>
            <label className="fl-case">
              <input type="checkbox" checked={vue.public} disabled={!hote} onChange={(e) => geste({ op: "regler", public: e.target.checked })} />
              <span>Visible au quai (sinon : sur code uniquement)</span>
            </label>
            {!hote && <p className="fl-doux">Seul l'hôte règle la bataille.</p>}
          </div>
        </section>
      </div>

      <footer className="fl-salon-pied">
        <button className="fl-btn" onClick={surQuitter}>Quitter le salon</button>
        <button className="fl-btn" onClick={surAide}>Règles du jeu</button>
        {moi && !hote && (
          <button className={`fl-btn-principal${moi.pret ? " verrouille" : ""}`} onClick={() => geste({ op: "pret", valeur: !moi.pret })}>
            {moi.pret ? "Prêt ✓ (annuler)" : "Je suis prêt"}
          </button>
        )}
        {hote && (
          <button className="fl-btn-principal" disabled={!peutLancer} onClick={() => geste({ op: "lancer" })}
            title={peutLancer ? "" : vue.joueurs.length < regles.min ? "Il faut au moins 2 flottes (ajoute un bot)" : "Tout le monde n'est pas prêt"}>
            Lever l'ancre
          </button>
        )}
        {hote && !peutLancer && (
          <p className="fl-doux">
            {vue.joueurs.length < regles.min ? "Il faut au moins deux flottes : invite un ami ou ajoute un bot."
              : `En attente : ${attente.map((j) => j.nom).join(", ")}.`}
          </p>
        )}
      </footer>
    </div>
  );
}
