"use client";

// Carnet du MJ : préparer une aventure en étapes, puis la dérouler pendant la soirée.
// Une étape = texte à lire, notes privées, documents à montrer, et une « photo » du
// plateau (scène, ambiance, brouillard, monstres et PNJ placés) qu'on installe d'un clic.
// Préparer une rencontre = la monter sur le plateau, puis 📸 la photographier dans l'étape.

import { useEffect, useMemo, useState } from "react";
import MediaPicker from "@/components/MediaPicker";
import type { Aventure, Document, Etape, Etat, Op } from "./types";

const nouvelId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const nouvelleEtape = (n: number): Etape => ({ id: nouvelId(), titre: `Étape ${n}`, texte: "", notes: "", documents: [], fait: false, photo: null });
const nouvelleAventure = (): Aventure => ({ id: "", titre: "Nouvelle aventure", resume: "", etapes: [nouvelleEtape(1)] });

export default function Carnet({ aventures, etat, op }: { aventures: Aventure[]; etat: Etat; op: Op }) {
  const [choix, setChoix] = useState<string>(etat.mj?.aventure_id || aventures[0]?.id || "");
  const [brouillon, setBrouillon] = useState<Aventure | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(etat.mj?.etape_id || null);
  const [occupe, setOccupe] = useState(false);

  const serveur = useMemo(() => aventures.find((a) => a.id === choix) || null, [aventures, choix]);
  // Le brouillon suit la version serveur tant qu'on ne l'a pas modifié.
  const [modifie, setModifie] = useState(false);
  useEffect(() => {
    if (!modifie) setBrouillon(serveur ? structuredClone(serveur) : null);
  }, [serveur, modifie]);

  const a = brouillon;
  const changer = (f: (x: Aventure) => Aventure) => {
    if (!a) return;
    setBrouillon(f(structuredClone(a)));
    setModifie(true);
  };
  const majEtape = (id: string, champs: Partial<Etape>) =>
    changer((x) => ({ ...x, etapes: x.etapes.map((s) => (s.id === id ? { ...s, ...champs } : s)) }));

  const sauver = async (av: Aventure | null = a): Promise<Aventure | null> => {
    if (!av) return null;
    setOccupe(true);
    const d = await op({ op: "aventure_sauver", aventure: av });
    setOccupe(false);
    if (!d) return null;
    const s = d.aventure as Aventure;
    setModifie(false);
    setChoix(s.id);
    return s;
  };
  // Les gestes sur une étape exigent qu'elle existe côté bot : on enregistre d'abord si besoin.
  const surEtape = async (gestes: Record<string, unknown>, etapeId: string) => {
    let av = a;
    if (modifie || !a?.id) av = await sauver();
    if (!av) return;
    await op({ ...gestes, aventure_id: av.id, etape_id: etapeId });
  };

  const actuelle = etat.mj?.aventure_id === a?.id ? etat.mj?.etape_id : "";

  return (
    <div className="plateau-section carnet">
      <div className="carnet-choix">
        <select
          value={choix}
          onChange={(e) => {
            if (modifie && !window.confirm("Abandonner les modifications non enregistrées ?")) return;
            setModifie(false);
            setChoix(e.target.value);
            op({ op: "aventure_choisir", id: e.target.value });
          }}
        >
          <option value="">— Choisir une aventure —</option>
          {aventures.map((x) => (
            <option key={x.id} value={x.id}>{x.titre}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (modifie && !window.confirm("Abandonner les modifications non enregistrées ?")) return;
            setChoix("");
            setBrouillon(nouvelleAventure());
            setModifie(true);
          }}
        >
          + Nouvelle
        </button>
      </div>

      {!a ? (
        <p className="piste-vide">
          Prépare ta soirée : crée une aventure, découpe-la en étapes (arrivée au village, la crypte, le boss…).
          Pour chaque étape, monte la scène sur le plateau puis 📸 photographie-la : le soir venu, ▶ Lancer
          l&apos;installe en un clic. Rien de ce carnet n&apos;est visible des joueurs.
        </p>
      ) : (
        <>
          <input className="plateau-fiche-nom" value={a.titre} maxLength={80} onChange={(e) => changer((x) => ({ ...x, titre: e.target.value }))} />
          <textarea rows={2} value={a.resume} maxLength={2000} placeholder="Résumé, fil rouge, ce que les joueurs doivent découvrir…" onChange={(e) => changer((x) => ({ ...x, resume: e.target.value }))} />

          <ol className="carnet-etapes">
            {a.etapes.map((s, i) => (
              <li key={s.id} className={`${s.fait ? "fait" : ""} ${actuelle === s.id ? "actuelle" : ""}`}>
                <div className="carnet-etape-tete">
                  <input type="checkbox" checked={s.fait} title="Étape jouée" onChange={(e) => majEtape(s.id, { fait: e.target.checked })} />
                  <button className="carnet-etape-titre" onClick={() => setOuverte(ouverte === s.id ? null : s.id)}>
                    {i + 1}. {s.titre} {actuelle === s.id && <em>· en cours</em>}
                  </button>
                  <button className="carnet-lancer" disabled={occupe} title={s.photo ? "Installer la scène de l'étape" : "Marquer l'étape en cours (pas de photo du plateau)"} onClick={() => surEtape({ op: "etape_lancer" }, s.id)}>
                    ▶
                  </button>
                </div>
                {ouverte === s.id && (
                  <div className="carnet-etape">
                    <input value={s.titre} maxLength={80} onChange={(e) => majEtape(s.id, { titre: e.target.value })} />
                    <label>À lire aux joueurs</label>
                    <textarea rows={4} value={s.texte} maxLength={4000} placeholder="« La porte grince. Une odeur de cire froide… »" onChange={(e) => majEtape(s.id, { texte: e.target.value })} />
                    {s.texte.trim() && (
                      <button onClick={() => op({ op: "montrer", titre: s.titre, texte: s.texte })}>📢 Afficher ce texte aux joueurs</button>
                    )}
                    <label>Notes du MJ (privées)</label>
                    <textarea rows={4} value={s.notes} maxLength={4000} placeholder="PV, DD, pièges, indices, réactions des PNJ…" onChange={(e) => majEtape(s.id, { notes: e.target.value })} />

                    <label>Plateau de l&apos;étape</label>
                    <p className="piste-vide">
                      {s.photo
                        ? `📸 ${s.photo.scene?.nom || "carte perso"} · ${s.photo.pions?.length ?? 0} pion(s) · prise le ${new Date(s.photo.prise * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                        : "Pas encore de photo : monte la scène sur le plateau puis photographie-la."}
                    </p>
                    <button
                      disabled={occupe}
                      onClick={() =>
                        (!s.photo || window.confirm("Remplacer la photo de cette étape par le plateau actuel ?")) &&
                        surEtape({ op: "etape_photo" }, s.id)
                      }
                    >
                      📸 Photographier le plateau actuel
                    </button>

                    <label>Documents à montrer</label>
                    {s.documents.map((doc: Document) => (
                      <div key={doc.id} className="carnet-doc">
                        <input value={doc.titre} placeholder="Lettre du baron, portrait…" maxLength={80}
                          onChange={(e) => majEtape(s.id, { documents: s.documents.map((x) => (x.id === doc.id ? { ...x, titre: e.target.value } : x)) })} />
                        <MediaPicker value={doc.image_url} onChange={(v) => majEtape(s.id, { documents: s.documents.map((x) => (x.id === doc.id ? { ...x, image_url: v } : x)) })} />
                        <textarea rows={2} value={doc.texte} maxLength={3000} placeholder="Texte du document (facultatif)"
                          onChange={(e) => majEtape(s.id, { documents: s.documents.map((x) => (x.id === doc.id ? { ...x, texte: e.target.value } : x)) })} />
                        <div className="carnet-doc-actions">
                          <button onClick={() => op({ op: "montrer", titre: doc.titre, texte: doc.texte, image_url: doc.image_url })}>📢 Montrer</button>
                          <button onClick={() => majEtape(s.id, { documents: s.documents.filter((x) => x.id !== doc.id) })}>Retirer</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => majEtape(s.id, { documents: [...s.documents, { id: nouvelId(), titre: "", texte: "", image_url: "" }] })}>+ Document</button>

                    <div className="carnet-doc-actions">
                      <button disabled={i === 0} onClick={() => changer((x) => { const e = x.etapes; [e[i - 1], e[i]] = [e[i], e[i - 1]]; return x; })}>↑</button>
                      <button disabled={i === a.etapes.length - 1} onClick={() => changer((x) => { const e = x.etapes; [e[i + 1], e[i]] = [e[i], e[i + 1]]; return x; })}>↓</button>
                      <button onClick={() => window.confirm(`Supprimer l'étape « ${s.titre} » ?`) && changer((x) => ({ ...x, etapes: x.etapes.filter((y) => y.id !== s.id) }))}>Supprimer l&apos;étape</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <button onClick={() => changer((x) => ({ ...x, etapes: [...x.etapes, nouvelleEtape(x.etapes.length + 1)] }))}>+ Étape</button>

          <div className="carnet-barre">
            <button className="piste-lancer" disabled={!modifie || occupe} onClick={() => sauver()}>
              {modifie ? "💾 Enregistrer l'aventure" : "✓ Enregistrée"}
            </button>
            {a.id && (
              <button className="plateau-suppr" onClick={() => window.confirm(`Supprimer « ${a.titre} » ?`) && op({ op: "aventure_supprimer", id: a.id }).then(() => { setModifie(false); setChoix(""); })}>
                Supprimer
              </button>
            )}
          </div>
        </>
      )}

      {etat.affiche && (
        <button className="plateau-suppr" onClick={() => op({ op: "montrer_retirer" })}>Retirer le document affiché aux joueurs</button>
      )}
    </div>
  );
}
