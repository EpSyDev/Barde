"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Loading, Vide } from "@/components/ui";
import Parchemin from "@/components/Parchemin";

type Jour = { jour: string; arrivees: number; departs: number; messages: number; actifs: number };
type Resume = {
  jours: number;
  membres: number | null;
  totaux: { arrivees: number; departs: number; solde: number; messages: number; actifs: number };
  par_jour: Jour[];
  heures: number[];
  top_actifs: { nom: string; messages: number }[];
  jeux: { nom: string; minutes: number; sessions: number; joueurs: number }[];
  categories: { id: string; nom: string; messages: number; actifs: number; minutes_vocal: number; derniere_activite: string | null }[];
};

const PERIODES = [7, 30, 90];

/** Histogramme SVG léger : une barre par valeur, survol = valeur exacte. */
function Barres({ valeurs, etiquettes, couleur = "var(--gold)", hauteur = 90 }: {
  valeurs: number[];
  etiquettes: string[];
  couleur?: string;
  hauteur?: number;
}) {
  const max = Math.max(1, ...valeurs);
  const n = valeurs.length;
  return (
    <svg viewBox={`0 0 ${n * 10} ${hauteur}`} preserveAspectRatio="none" style={{ width: "100%", height: hauteur, display: "block" }} role="img">
      {valeurs.map((v, i) => {
        const h = (v / max) * (hauteur - 4);
        return (
          <rect key={i} x={i * 10 + 1} y={hauteur - h} width={8} height={Math.max(h, v > 0 ? 1 : 0)} fill={couleur} rx={1}>
            <title>{`${etiquettes[i]} : ${v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

const duree = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);
const court = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Statistiques mesurées du serveur : flux de membres, activité, heures de pointe, jeux. */
export default function Stats() {
  const [jours, setJours] = useState(30);
  const [d, setD] = useState<Resume | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/fripouille/action/stats/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jours }),
      });
      if (!r.ok) throw new Error();
      setD(await r.json());
      setErreur(null);
    } catch {
      setErreur("La Fripouille est injoignable.");
    }
  }, [jours]);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000);
    return () => clearInterval(t);
  }, [charger]);

  if (erreur && !d) return <Vide>{erreur}</Vide>;
  if (!d) return <Loading lignes={5} />;
  const t = d.totaux;
  const etiq = d.par_jour.map((j) => court(j.jour));
  const maxH = Math.max(...d.heures);
  const pointe = maxH > 0 ? d.heures.indexOf(maxH) : null;
  const vide = t.messages === 0 && t.arrivees === 0 && t.departs === 0 && d.jeux.length === 0;

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="registre" />
          </span>
          <div>
            <h2>La vie du serveur</h2>
            <p>
              Chiffres mesurés par le bot depuis son activation — jamais le contenu des messages. Heure de Paris.
            </p>
          </div>
        </div>
        <div className="tabs">
          {PERIODES.map((p) => (
            <button key={p} className={`tab ${jours === p ? "active" : ""}`} onClick={() => setJours(p)}>
              {p} jours
            </button>
          ))}
        </div>
        {vide && <p className="cfg-hint">Les compteurs se remplissent à partir de maintenant : reviens dans quelques jours.</p>}
        <div className="game-list">
          <div className="game-row"><span className="game-label">Membres actuels</span><span className="game-cat">{d.membres ?? "—"}</span></div>
          <div className="game-row"><span className="game-label">Arrivées / départs</span><span className="game-cat">+{t.arrivees} / −{t.departs} (solde {t.solde >= 0 ? "+" : ""}{t.solde})</span></div>
          <div className="game-row"><span className="game-label">Messages</span><span className="game-cat">{t.messages.toLocaleString("fr-FR")}</span></div>
          <div className="game-row"><span className="game-label">Membres actifs (≥ 1 message)</span><span className="game-cat">{t.actifs}</span></div>
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>Arrivées par jour</h2></div>
        <Barres valeurs={d.par_jour.map((j) => j.arrivees)} etiquettes={etiq} couleur="var(--green)" />
        <div className="cfg-card-head" style={{ marginTop: 14 }}><h2>Départs par jour</h2></div>
        <Barres valeurs={d.par_jour.map((j) => j.departs)} etiquettes={etiq} couleur="var(--red)" />
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>Activité</h2><p>Messages par jour, puis membres actifs par jour.</p></div>
        <Barres valeurs={d.par_jour.map((j) => j.messages)} etiquettes={etiq} />
        <div style={{ height: 14 }} />
        <Barres valeurs={d.par_jour.map((j) => j.actifs)} etiquettes={etiq} couleur="var(--blue)" />
        {d.top_actifs.length > 0 && (
          <>
            <h3>Les plus bavards</h3>
            <div className="game-list">
              {d.top_actifs.map((a) => (
                <div className="game-row" key={a.nom}>
                  <span className="game-label">{a.nom}</span>
                  <span className="game-cat">{a.messages} msg</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Heures de pointe</h2>
          <p>{pointe !== null ? `Pic d'activité vers ${pointe} h (messages cumulés sur la période).` : "Pas encore de données."}</p>
        </div>
        <Barres valeurs={d.heures} etiquettes={d.heures.map((_, h) => `${h} h`)} couleur="var(--ember)" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", opacity: 0.7 }}>
          <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span>
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Par catégorie</h2>
          <p>
            Messages, membres actifs et temps passé en vocal dans chaque catégorie sur la période (mesuré depuis le 11/10 au soir).
            Une catégorie à zéro partout est marquée « endormie ».
          </p>
        </div>
        {(d.categories || []).length === 0 ? (
          <Parchemin icone="graphique" titre="Pas encore de données">Les chiffres arrivent avec l&apos;activité du serveur.</Parchemin>
        ) : (
          <div className="game-list">
            {(d.categories || []).map((c) => {
              const endormie = c.messages === 0 && c.minutes_vocal === 0;
              return (
                <div className="game-row" key={c.id} style={endormie ? { opacity: 0.6 } : undefined}>
                  <span className="game-label">
                    <b>{c.nom}</b>
                    {endormie ? " — 💤 endormie" : ` — ${c.messages} msg · ${c.actifs} actif(s) · ${duree(c.minutes_vocal)} de vocal`}
                  </span>
                  <span className="game-cat">{c.derniere_activite ? `dernière activité ${court(c.derniere_activite)}` : "jamais vue active"}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Jeux les plus joués</h2>
          <p>Temps cumulé des parties suivies par « En ligne » (il doit être activé).</p>
        </div>
        {d.jeux.length === 0 ? (
          <Parchemin icone="manette" titre="Aucune partie enregistrée">Le temps de jeu vient du module En ligne.</Parchemin>
        ) : (
          <div className="game-list">
            {d.jeux.map((j) => (
              <div className="game-row" key={j.nom}>
                <span className="game-label">
                  <b>{j.nom}</b> — {j.joueurs} joueur(s) · {j.sessions} session(s)
                </span>
                <span className="game-cat">{duree(j.minutes)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
