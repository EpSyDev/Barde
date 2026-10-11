"use client";

// Carte de rôle : dos scellé à la cire, face enluminée. « Maintenir pour regarder » : la
// carte se referme dès qu'on relâche (sûr en stream), sauf si on l'épingle ouverte.

import { useState } from "react";
import { CAMPS, CARTES, ROLES, type CarteId, type RoleId } from "@/lib/ombres";
import { Embleme, EmblemeCarte } from "./Emblemes";

type Props = {
  role: RoleId | null;
  ouverte?: boolean;           // forcée ouverte (révélation, fin de partie, MJ)
  maintenir?: boolean;         // ouverture au maintien (carte du joueur)
  taille?: "s" | "m" | "l";
  detail?: boolean;            // pouvoir + devise
  onRetourne?: () => void;
};

export function CarteRole({ role, ouverte = false, maintenir = false, taille = "m", detail = true, onRetourne }: Props) {
  const [tenue, setTenue] = useState(false);
  const [epinglee, setEpinglee] = useState(false);
  const visible = !!role && (ouverte || tenue || epinglee);
  const r = role ? ROLES[role] : null;
  const camp = r ? CAMPS[r.camp] : null;
  const tenir = (v: boolean) => {
    if (!maintenir) return;
    if (v && !tenue) onRetourne?.();
    setTenue(v);
  };
  return (
    <div className={`om-carte om-carte-${taille}`} data-camp={r?.camp}>
      <div
        className={`om-carte-pivot${visible ? " ouverte" : ""}`}
        onPointerDown={(e) => { e.preventDefault(); tenir(true); }}
        onPointerUp={() => tenir(false)}
        onPointerLeave={() => tenir(false)}
        onPointerCancel={() => tenir(false)}
        onContextMenu={(e) => maintenir && e.preventDefault()}
        role={maintenir ? "button" : undefined}
        aria-label={maintenir ? "Maintenir pour regarder ta carte" : undefined}
        style={{ ["--camp" as string]: camp?.couleur, ["--camp-fonce" as string]: camp?.fonce }}
      >
        <div className="om-carte-face om-carte-dos">
          <div className="om-carte-dos-motif" />
          <Embleme role="dos" taille={taille === "l" ? 120 : taille === "m" ? 86 : 52} />
          {maintenir && taille !== "s" && <span className="om-carte-aide">Maintiens pour regarder</span>}
        </div>
        <div className="om-carte-face om-carte-recto">
          {r && camp && (
            <>
              <div className="om-carte-camp">{camp.nom}</div>
              <div className="om-carte-medaillon">
                <Embleme role={role!} taille={taille === "l" ? 128 : taille === "m" ? 92 : 50} />
              </div>
              <div className="om-carte-nom">{r.nom}</div>
              {detail && taille !== "s" && (
                <>
                  <div className="om-carte-devise">{r.devise}</div>
                  <div className="om-carte-pouvoir">{r.pouvoir}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {maintenir && role && taille !== "s" && (
        <button type="button" className="om-lien om-carte-epingle" onClick={() => setEpinglee((v) => !v)}>
          {epinglee ? "Refermer la carte" : "Laisser ouverte"}
        </button>
      )}
    </div>
  );
}

export function CarteEvenement({ carte, retournee = true, petite = false, compte, choisie, onChoisir }: {
  carte: CarteId; retournee?: boolean; petite?: boolean; compte?: number; choisie?: boolean; onChoisir?: () => void;
}) {
  const c = CARTES[carte];
  const Corps = onChoisir ? "button" : "div";
  return (
    <Corps
      type={onChoisir ? "button" : undefined}
      className={`om-evt${petite ? " petite" : ""}${choisie ? " choisie" : ""}${retournee ? " retournee" : ""}`}
      data-faveur={c.faveur}
      onClick={onChoisir}
    >
      <div className="om-evt-pivot">
        <div className="om-evt-face om-evt-dos"><Embleme role="dos" taille={petite ? 34 : 54} /></div>
        <div className="om-evt-face om-evt-recto">
          <EmblemeCarte carte={carte} taille={petite ? 34 : 64} />
          <div className="om-evt-nom">{c.nom}</div>
          {!petite && <div className="om-evt-texte">{c.texte}</div>}
        </div>
      </div>
      {compte !== undefined && <div className="om-evt-compte">{compte} âme{compte > 1 ? "s" : ""}</div>}
    </Corps>
  );
}
