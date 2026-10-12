"use client";

// Racine de la page /flotte : quai → salon → bataille → fin. Le salon courant vit dans
// l'URL (?salon=…) : un rechargement ou une reconnexion retombe sur la bonne partie.

import { useCallback, useEffect, useState } from "react";
import type { VueSalon } from "@/lib/flotte";
import Aide from "./Aide";
import Bataille, { REGLAGES_DEFAUT, type Reglages } from "./Bataille";
import Fin from "./Fin";
import Quai from "./Quai";
import Salon from "./Salon";
import { useFlotte } from "./useFlotte";

const CLE_REGLAGES = "flotte:reglages";

function lireReglages(): Reglages {
  const reduit = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const defaut: Reglages = { ...REGLAGES_DEFAUT, reduit: !!reduit };
  try {
    return { ...defaut, ...JSON.parse(localStorage.getItem(CLE_REGLAGES) || "{}") };
  } catch {
    return defaut;
  }
}

function salonDeLUrl(): string | null {
  const s = new URLSearchParams(window.location.search).get("salon");
  return s && /^[a-f0-9]{12}$/.test(s) ? s : null;
}

export default function Flotte() {
  const [salon, setSalon] = useState<string | null>(salonDeLUrl);
  const [message, setMessage] = useState<string | null>(null);
  const [aide, setAide] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [voirCarte, setVoirCarte] = useState(false);
  const [finPrete, setFinPrete] = useState(false);
  const [reglages, setReglages] = useState<Reglages>(lireReglages);

  const aller = useCallback((s: string | null) => {
    setSalon(s);
    const url = new URL(window.location.href);
    if (s) url.searchParams.set("salon", s);
    else url.searchParams.delete("salon");
    window.history.replaceState(null, "", url);
  }, []);

  const { vue, liaison, erreur, op, maintenant } = useFlotte(salon, useCallback(() => {
    aller(null);
    setMessage("Ce salon a levé l'ancre sans toi (fermé ou introuvable).");
  }, [aller]));

  const changerReglages = (r: Reglages) => {
    setReglages(r);
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(r)); } catch { /* navigation privée */ }
  };

  // Écran de fin : on laisse d'abord la dernière manche se jouer sur la carte.
  const phase = vue?.type === "salon" ? vue.phase : null;
  useEffect(() => {
    if (phase !== "fin") { setFinPrete(false); setVoirCarte(false); return; }
    const t = setTimeout(() => setFinPrete(true), reglages.reduit ? 600 : 6500);
    return () => clearTimeout(t);
  }, [phase, reglages.reduit]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const quitter = async () => {
    setConfirmer(false);
    if (vue?.type === "salon" && vue.phase !== "fin") {
      const r = await op({ op: "quitter", salon: vue.id });
      if (!r.ok) { setMessage(r.erreur || "Impossible de quitter."); return; }
    }
    aller(null);
  };

  const demanderQuitter = () => {
    const v = vue as VueSalon;
    const enMer = v?.type === "salon" && !["salon", "fin"].includes(v.phase)
      && v.joueurs.some((j) => j.uid === v.moi && j.elimine === null && !j.abandon);
    if (enMer) setConfirmer(true);
    else quitter();
  };

  let contenu: React.ReactNode;
  if (erreur) {
    contenu = <div className="fl-message"><h1>Accès refusé</h1><p>{erreur}</p><a className="fl-btn" href="/">Retour</a></div>;
  } else if (!vue) {
    contenu = <div className="fl-chargement" role="status"><span className="fl-boussole" aria-hidden="true" />On hisse les voiles…</div>;
  } else if (vue.type === "quai") {
    contenu = <Quai vue={vue} op={op} entrer={aller} surAide={() => setAide(true)} />;
  } else if (vue.phase === "salon") {
    contenu = <Salon vue={vue} op={op} surQuitter={demanderQuitter} surAide={() => setAide(true)} />;
  } else {
    contenu = (
      <>
        <Bataille vue={vue} op={op} maintenant={maintenant} reglages={reglages} changerReglages={changerReglages}
          surAide={() => setAide(true)} surQuitter={demanderQuitter} />
        {vue.phase === "fin" && finPrete && !voirCarte && <Fin vue={vue} op={op} surQuai={() => aller(null)} />}
        {vue.phase === "fin" && finPrete && (
          <button className="fl-btn fl-bascule-fin" onClick={() => setVoirCarte(!voirCarte)}>
            {voirCarte ? "Voir le classement" : "Voir la carte"}
          </button>
        )}
      </>
    );
  }

  return (
    <div className={`flotte${reglages.reduit ? " reduit" : ""}`}>
      {liaison === "perdue" && vue && <div className="fl-liaison" role="status">Liaison perdue avec la flotte — reconnexion…</div>}
      {message && <div className="fl-message-flottant" role="status">{message}</div>}
      {contenu}
      {aide && <Aide regles={vue?.type === "salon" ? vue.regles : null} reglages={reglages} changer={changerReglages} fermer={() => setAide(false)} />}
      {confirmer && (
        <div className="fl-voile" role="alertdialog" aria-modal="true" aria-labelledby="fl-q-titre">
          <div className="fl-confirmer">
            <h2 id="fl-q-titre">Amener ton pavillon ?</h2>
            <p>Quitter en pleine bataille saborde toute ta flotte : tu seras compté comme ayant abandonné.</p>
            <div>
              <button className="fl-btn" onClick={() => setConfirmer(false)} autoFocus>Rester à la barre</button>
              <button className="fl-btn-principal danger" onClick={quitter}>Abandonner</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
