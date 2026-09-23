"use client";

// La salle commune : ce qu'on veut savoir en poussant la porte, sans cliquer.
//
// Règle tenue partout ici : **tout chiffre affiché est mesuré**. Pas de « score de
// santé du serveur », pas d'indice composite calculé côté navigateur. Ce que le bot
// ne peut pas savoir (les membres en ligne — l'intent `presences` n'est pas activé)
// n'apparaît pas, plutôt que d'être approché.

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import {
  Stat, FlowBars, Loading, Vide, formatMontant, formatNombre, depuis, type Devise,
} from "@/components/ui";
import { runAction } from "@/lib/useModuleConfig";

type Tableau = {
  disponible: boolean;
  serveur?: { nom: string; icone: string | null; membres: number; boosts: number; niveau_boost: number };
  vocal?: { total: number; salons: { nom: string; membres: number }[] };
  tickets?: { ouverts: number; non_pris: number };
  // Le registre du baptême stocke `name` (nom RP) et `pseudo` (nom stylisé posé
  // comme pseudo serveur) — pas `nom`. Voir le roster dans modules/bapteme.py.
  bapteme?: {
    total: number;
    derniers: { user_id: string; name?: string; race_label?: string; at?: string }[];
  };
  economie?: {
    masse: { total: number; porteurs: number; moyenne: number; mediane: number; max: number };
    flux_24h: { entrees: Record<string, number>; sorties: Record<string, number>;
                total_entrees: number; total_sorties: number };
    anomalies: number;
    geles: number;
    devise: Devise;
  };
  moderation?: { semaine: Record<string, number>; total_semaine: number };
  journal?: { jour: Record<string, number> };
  modules_actifs?: string[];
};

export default function Accueil({ aller }: { aller: (id: string, membre?: string) => void }) {
  const [data, setData] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setData(await runAction<Tableau>("membres", "tableau"));
      setErreur(null);
    } catch {
      setErreur("La Fripouille est injoignable — aucun chiffre ne peut être affiché.");
    }
  }, []);

  useEffect(() => {
    charger();
    const id = setInterval(charger, 30000);
    return () => clearInterval(id);
  }, [charger]);

  if (erreur) return <Vide>{erreur}</Vide>;
  if (!data) return <Loading lignes={6} />;
  if (!data.disponible) {
    return <Vide>Le bot n&apos;est rattaché à aucun serveur (GUILD_ID absent).</Vide>;
  }

  const { serveur, vocal, tickets, bapteme, economie, moderation, journal } = data;
  const devise = economie?.devise;
  const arrivees = journal?.jour?.membre_arrivee ?? 0;
  const departs = journal?.jour?.membre_depart ?? 0;

  return (
    <>
      <p className="section-intro">
        Tout ce qui suit est compté, pas estimé. Les membres connectés n&apos;y figurent
        pas : le bot ne demande pas l&apos;autorisation Discord qui permettrait de les voir.
      </p>

      <div className="stat-grid">
        <Stat
          icon="personnes"
          label="Habitants"
          value={formatNombre(serveur?.membres)}
          hint={
            arrivees || departs
              ? `${arrivees} arrivée${arrivees > 1 ? "s" : ""} · ${departs} départ${departs > 1 ? "s" : ""} en 24 h`
              : "aucun mouvement en 24 h"
          }
        />
        <Stat
          icon="cor"
          label="En vocal"
          value={formatNombre(vocal?.total)}
          hint={
            vocal?.salons?.length
              ? vocal.salons.slice(0, 2).map((s) => `${s.nom} (${s.membres})`).join(" · ")
              : "les salons sont silencieux"
          }
        />
        <Stat
          icon="ticket"
          label="Tickets ouverts"
          value={formatNombre(tickets?.ouverts)}
          hint={
            tickets?.non_pris
              ? `${tickets.non_pris} sans personne dessus`
              : "tous pris en charge"
          }
          alert={!!tickets?.non_pris}
        />
        <Stat
          icon="coffre"
          label="Masse monétaire"
          value={formatMontant(economie?.masse.total ?? 0, devise)}
          hint={`${formatNombre(economie?.masse.porteurs)} porteurs · médiane ${formatMontant(economie?.masse.mediane ?? 0, devise)}`}
        />
        <Stat
          icon="chandelle"
          label="Baptisés"
          value={formatNombre(bapteme?.total)}
          hint={
            bapteme?.derniers?.[0]?.at
              ? `dernier ${depuis(bapteme.derniers[0].at)}`
              : "aucun baptême enregistré"
          }
        />
        <Stat
          icon="balance"
          label="Sanctions (7 j)"
          value={formatNombre(moderation?.total_semaine)}
          hint={
            moderation?.total_semaine
              ? Object.entries(moderation.semaine)
                  .map(([k, v]) => `${v} ${LIBELLE_SANCTION[k] || k}`)
                  .join(" · ")
              : "semaine calme"
          }
        />
        {!!economie?.anomalies && (
          <Stat
            icon="alerte"
            label="Écarts de gains"
            value={formatNombre(economie.anomalies)}
            hint="comptes très au-dessus de la médiane — à regarder"
            alert
          />
        )}
        {!!economie?.geles && (
          <Stat
            icon="gel"
            label="Comptes gelés"
            value={formatNombre(economie.geles)}
            hint="ni gain ni dépense tant qu'ils le sont"
          />
        )}
      </div>

      <div className="cfg-grid wide">
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="bourse" /></span>
            <div>
              <h2>D&apos;où viennent les écus (24 h)</h2>
              <p>Création de monnaie par source, et dépenses en regard.</p>
            </div>
          </div>
          <FlowBars
            entries={economie?.flux_24h.entrees || {}}
            total={economie?.flux_24h.total_entrees || 0}
            devise={devise}
            vide="Aucun écu créé depuis hier."
          />
          {!!economie?.flux_24h.total_sorties && (
            <>
              <div className="cfg-field" style={{ marginTop: 20, marginBottom: 10 }}>
                <label>Dépenses</label>
              </div>
              <FlowBars
                entries={economie.flux_24h.sorties}
                total={economie.flux_24h.total_sorties}
                devise={devise}
                sortant
              />
            </>
          )}
          <div className="row end" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => aller("tresorerie")}>
              <Icon name="coffre" /> Ouvrir la trésorerie
            </button>
          </div>
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="chandelle" /></span>
            <div>
              <h2>Derniers baptisés</h2>
              <p>Les cinq noms consacrés les plus récents.</p>
            </div>
          </div>
          {bapteme?.derniers?.length ? (
            <div className="timeline">
              {bapteme.derniers.map((b) => (
                <div className="tl-row" key={b.user_id}>
                  <div className="tl-head">
                    <span className="tl-kind">Baptême</span>
                    <span className="tl-time">{depuis(b.at)}</span>
                  </div>
                  <div className="tl-body">
                    <strong>{b.name || "—"}</strong>
                    {b.race_label && <span className="muted"> · {b.race_label}</span>}
                  </div>
                  <button
                    className="link"
                    onClick={() => aller("membres", b.user_id)}
                    style={{ marginTop: 4 }}
                  >
                    Voir la fiche
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Personne n&apos;a encore reçu de nom.</p>
          )}
          <div className="row end" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => aller("registre")}>
              <Icon name="parchemin" /> Le registre complet
            </button>
          </div>
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="cor" /></span>
            <div>
              <h2>Salons vocaux occupés</h2>
              <p>Qui fait du bruit, en direct.</p>
            </div>
          </div>
          {vocal?.salons?.length ? (
            <div className="stack">
              {vocal.salons.map((s) => (
                <div className="game-row" key={s.nom}>
                  <span className="game-emoji"><Icon name="cor" size={16} /></span>
                  <span className="game-label">{s.nom}</span>
                  <span className="tag gold">{s.membres}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucun salon vocal occupé pour l&apos;instant.</p>
          )}
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="engrenage" /></span>
            <div>
              <h2>Modules allumés</h2>
              <p>Ce que le bot fait réellement en ce moment.</p>
            </div>
          </div>
          {data.modules_actifs?.length ? (
            <div className="chips">
              {data.modules_actifs.map((m) => (
                <span className="chip" key={m}>
                  <span className="flame"><Icon name="chandelle" size={13} /></span>
                  {m}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">Aucun module activé — le bot est présent mais inerte.</p>
          )}
          {!!serveur?.boosts && (
            <p className="stat-hint" style={{ marginTop: 14 }}>
              {serveur.boosts} boost{serveur.boosts > 1 ? "s" : ""} · niveau {serveur.niveau_boost}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

const LIBELLE_SANCTION: Record<string, string> = {
  warn: "avertissement(s)",
  timeout: "exclusion(s)",
  kick: "expulsion(s)",
  ban: "bannissement(s)",
  note: "note(s)",
  unban: "levée(s)",
};
