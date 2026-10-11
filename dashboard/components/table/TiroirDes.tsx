"use client";

// Piste de dés 3D posée sur la table : chaque jet du fil (le sien comme celui des autres)
// y roule pour tout le monde. Le tirage est fait par La Fripouille ; ici on n'anime que
// des dés qui tombent sur le résultat reçu. La piste n'existe que le temps d'un lancer
// (WebGL coûteux sur un portable), sauf si on l'épingle.

import { useEffect, useRef, useState } from "react";
import { PisteDes3D, definirPolice, type DeTire } from "@/lib/des3d";

export type JetAnime = { id: string; qui: string; raison: string; total: number | null; nat: number | null; des: DeTire[] };

const DUREE_AFFICHAGE = 3500; // ms après l'arrêt des dés

export default function TiroirDes({ jet, epingle, onEpingle }: { jet: JetAnime | null; epingle: boolean; onEpingle: (v: boolean) => void }) {
  const hote = useRef<HTMLDivElement>(null);
  const piste = useRef<PisteDes3D | null>(null);
  const prete = useRef<Promise<void> | null>(null);
  const file = useRef<Promise<void>>(Promise.resolve());
  const fermeture = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(epingle);
  const [affiche, setAffiche] = useState<JetAnime | null>(null);
  const [roule, setRoule] = useState(false);

  // Création / destruction de la scène 3D avec la visibilité du tiroir.
  useEffect(() => {
    if (!visible) return;
    let vivant = true;
    prete.current = (async () => {
      const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-title").trim();
      if (fam) {
        try {
          await document.fonts.load(`700 64px ${fam}`);
        } catch {
          /* police de secours */
        }
        definirPolice(fam);
      }
      if (vivant && hote.current) piste.current = new PisteDes3D(hote.current);
    })();
    return () => {
      vivant = false;
      piste.current?.detruire();
      piste.current = null;
      prete.current = null;
    };
  }, [visible]);

  const epingleRef = useRef(epingle);
  useEffect(() => {
    epingleRef.current = epingle;
    if (epingle) {
      if (fermeture.current) clearTimeout(fermeture.current);
      setVisible(true);
    }
  }, [epingle]);

  // Chaque nouveau jet visible : on ouvre, on fait rouler, puis on referme (sauf épinglé).
  useEffect(() => {
    if (!jet || !jet.des.length) return;
    if (fermeture.current) clearTimeout(fermeture.current);
    setVisible(true);
    file.current = file.current.then(async () => {
      // le temps que React monte l'hôte puis que la scène soit prête
      for (let i = 0; i < 20 && !prete.current; i++) await new Promise((r) => setTimeout(r, 25));
      await prete.current;
      if (!piste.current) return;
      setAffiche(null);
      setRoule(true);
      await piste.current.lancer(jet.des.slice(0, 24), jet.nat);
      setRoule(false);
      setAffiche(jet);
    });
    file.current.then(() => {
      if (!epingleRef.current) fermeture.current = setTimeout(() => setVisible(false), DUREE_AFFICHAGE);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jet?.id]);

  useEffect(() => () => { if (fermeture.current) clearTimeout(fermeture.current); }, []);

  if (!visible) {
    return (
      <button className="tiroir-des-poignee" onClick={() => onEpingle(true)} title="Garder la piste de dés ouverte">
        🎲 Piste
      </button>
    );
  }
  return (
    <div className="tiroir-des" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="tiroir-des-tete">
        <span>{affiche ? <><b>{affiche.qui}</b>{affiche.raison ? ` · ${affiche.raison}` : ""}</> : roule ? "Ça roule…" : "Piste de dés"}</span>
        <button
          className={epingle ? "on" : ""}
          onClick={() => {
            onEpingle(!epingle);
            if (epingle) setVisible(false);
          }}
          title={epingle ? "Refermer la piste" : "Garder la piste ouverte"}
        >
          {epingle ? "✕" : "📌"}
        </button>
      </div>
      <div className="tiroir-des-scene" ref={hote}>
        {affiche && !roule && affiche.total !== null && (
          <div className={`piste-total ${affiche.nat === 20 ? "crit" : affiche.nat === 1 ? "fumble" : ""}`}>
            <span className="piste-total-val">{affiche.total}</span>
            {affiche.nat === 20 && <span className="piste-total-msg">Réussite critique !</span>}
            {affiche.nat === 1 && <span className="piste-total-msg">Échec critique…</span>}
          </div>
        )}
      </div>
    </div>
  );
}
