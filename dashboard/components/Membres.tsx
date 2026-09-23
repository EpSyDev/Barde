"use client";

// La fiche d'un habitant : tout ce que la taverne sait de lui, sur un seul écran.
// Avant, la même question (« c'est qui, celui-là ? ») demandait d'ouvrir le registre,
// l'économie, les tickets et de recoller les morceaux de tête.
//
// La fiche est aussi le poste de commande : avertir, exclure, geler, ajuster — les
// gestes se font là où l'on a le contexte pour les décider.

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { runAction } from "@/lib/useModuleConfig";
import {
  Loading, Vide, formatMontant, formatNombre, depuis, dateCourte, duree, libelleSource,
  type Devise,
} from "@/components/ui";

type Membre = {
  id: string; tag: string; nom: string; avatar: string | null; absent?: boolean;
  bot?: boolean; arrive_le?: string | null; compte_cree_le?: string;
  anciennete_jours?: number | null; boost?: boolean; timeout_jusqu_a?: string | null;
  roles?: { id: string; nom: string; couleur: number }[];
};

type Sanction = {
  id: number; user_id: string; kind: string; reason: string; moderator: string;
  ts: string; expires_ts: string | null; active: boolean; lifted_by: string;
};

type Mouvement = { id: number; amount: number; reason: string; ts: string };
type Evenement = { id: number; ts: string; kind: string; kind_label: string;
                   summary: string; actor_tag: string };

type Fiche = {
  membre: Membre;
  economie: {
    solde: number; gele: boolean; devise: Devise;
    inventaire: { item_id: string; qty: number; nom: string }[];
    mouvements: Mouvement[];
  };
  bapteme: { nom?: string; race?: string; trait?: string; at?: string } | null;
  moderation: { sanctions: Sanction[]; warns_actifs: number };
  tickets: { channel_id: string; nom: string; cree_le: string | null }[];
  journal: Evenement[];
};

const SANCTION_LABEL: Record<string, string> = {
  note: "Observation", warn: "Avertissement", timeout: "Exclusion",
  kick: "Expulsion", ban: "Bannissement", unban: "Levée de bannissement",
};

const DUREES = [
  { minutes: 10, label: "10 minutes" },
  { minutes: 60, label: "1 heure" },
  { minutes: 1440, label: "1 jour" },
  { minutes: 10080, label: "7 jours" },
];

export default function Membres({
  cible,
  onCibleConsommee,
}: {
  cible: string | null;
  onCibleConsommee: () => void;
}) {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<Membre[]>([]);
  const [cherche, setCherche] = useState(false);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const toasts = useToasts();

  const ouvrir = useCallback(async (userId: string) => {
    setChargement(true);
    setErreur(null);
    try {
      setFiche(await runAction<Fiche>("membres", "fiche", { user_id: userId }));
    } catch (e) {
      setErreur((e as Error).message || "Fiche introuvable.");
      setFiche(null);
    } finally {
      setChargement(false);
    }
  }, []);

  // Fiche demandée depuis la palette ou un autre écran.
  useEffect(() => {
    if (!cible) return;
    ouvrir(cible);
    onCibleConsommee();
  }, [cible, ouvrir, onCibleConsommee]);

  const chercher = async (terme: string) => {
    if (terme.trim().length < 2) {
      setResultats([]);
      return;
    }
    setCherche(true);
    try {
      const data = await runAction<{ membres: Membre[] }>("membres", "rechercher", {
        q: terme.trim(), limit: 12,
      });
      setResultats(data.membres || []);
    } catch {
      setResultats([]);
    } finally {
      setCherche(false);
    }
  };

  const sanctionner = async (kind: string, minutes?: number) => {
    if (!fiche) return;
    const motif = window.prompt(
      `${SANCTION_LABEL[kind]} — motif (communiqué au membre en message privé) :`
    );
    if (motif === null) return;
    try {
      const res = await runAction<{ ok: boolean; error?: string; escalade?: Sanction }>(
        "moderation", "sanctionner",
        { user_id: fiche.membre.id, kind, reason: motif, minutes }
      );
      if (!res.ok) {
        toasts.err("Sanction refusée", res.error);
        return;
      }
      toasts.ok(
        `${SANCTION_LABEL[kind]} appliqué`,
        res.escalade
          ? `Escalade automatique : ${SANCTION_LABEL[res.escalade.kind]}.`
          : undefined
      );
      await ouvrir(fiche.membre.id);
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  const lever = async (id: number) => {
    if (!fiche) return;
    try {
      const res = await runAction<{ ok: boolean; error?: string }>("moderation", "lever", { id });
      if (!res.ok) return toasts.err("Levée impossible", res.error);
      toasts.ok("Sanction levée");
      await ouvrir(fiche.membre.id);
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  const basculerGel = async () => {
    if (!fiche) return;
    const gele = !fiche.economie.gele;
    const motif = gele ? window.prompt("Motif du gel :", "vérification en cours") : "";
    if (gele && motif === null) return;
    try {
      await runAction("economie", "geler", { user_id: fiche.membre.id, gele, note: motif || "" });
      toasts.ok(gele ? "Compte gelé" : "Compte dégelé");
      await ouvrir(fiche.membre.id);
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  const ajuster = async () => {
    if (!fiche) return;
    const saisie = window.prompt(
      "Ajustement du solde (nombre négatif pour retirer) :", "0"
    );
    if (saisie === null) return;
    const montant = Number(saisie);
    if (!Number.isFinite(montant) || montant === 0) {
      return toasts.err("Montant invalide");
    }
    const motif = window.prompt("Motif de l'ajustement :", "correction") || "correction";
    try {
      const res = await runAction<{ solde: number }>("economie", "ajuster", {
        user_id: fiche.membre.id, montant, motif,
      });
      toasts.ok("Solde ajusté", `Nouveau solde : ${res.solde}.`);
      await ouvrir(fiche.membre.id);
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  return (
    <>
      <div className="search-row">
        <input
          className="input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            chercher(e.target.value);
          }}
          placeholder="Pseudo, nom affiché ou identifiant Discord…"
          aria-label="Chercher un membre"
        />
        {cherche && <span className="muted">recherche…</span>}
      </div>

      {resultats.length > 0 && !fiche && (
        <div className="result-list" style={{ marginBottom: 20 }}>
          {resultats.map((m) => (
            <button key={m.id} className="result-row" onClick={() => ouvrir(m.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.avatar && <img src={m.avatar} alt="" />}
              <span>{m.nom}</span>
              <span className="result-sub">{m.tag}</span>
            </button>
          ))}
        </div>
      )}

      {chargement && <Loading lignes={6} />}
      {erreur && <Vide>{erreur}</Vide>}

      {!fiche && !chargement && !erreur && (
        <Vide>
          Cherche un habitant ci-dessus, ou ouvre sa fiche depuis la palette (⌘K).
        </Vide>
      )}

      {fiche && !chargement && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <button className="btn ghost small" onClick={() => setFiche(null)}>
              ← Retour à la recherche
            </button>
            <div className="spacer" />
            <button className="btn small" onClick={() => ouvrir(fiche.membre.id)}>
              Rafraîchir
            </button>
          </div>

          <section className="cfg-card">
            <FicheEntete fiche={fiche} />

            <div className="row" style={{ marginBottom: 20, gap: 8 }}>
              <button className="btn small" onClick={() => sanctionner("note")}>
                <Icon name="plume" /> Observation
              </button>
              <button className="btn small" onClick={() => sanctionner("warn")}>
                <Icon name="alerte" /> Avertir
              </button>
              {DUREES.map((d) => (
                <button
                  key={d.minutes}
                  className="btn small"
                  onClick={() => sanctionner("timeout", d.minutes)}
                  title={`Exclusion temporaire de ${d.label}`}
                >
                  <Icon name="clepsydre" /> {d.label}
                </button>
              ))}
              <button className="btn small danger" onClick={() => sanctionner("kick")}>
                Expulser
              </button>
              <button className="btn small danger" onClick={() => sanctionner("ban")}>
                Bannir
              </button>
            </div>

            <div className="sheet-cols">
              <div>
                <div className="sheet-block">
                  <h3><Icon name="bourse" /> Écus</h3>
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <span className="stat-value" style={{ fontSize: "var(--step-2)" }}>
                      {formatMontant(fiche.economie.solde, fiche.economie.devise)}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn small" onClick={ajuster}>Ajuster</button>
                      <button
                        className={`btn small ${fiche.economie.gele ? "" : "danger"}`}
                        onClick={basculerGel}
                      >
                        <Icon name="gel" /> {fiche.economie.gele ? "Dégeler" : "Geler"}
                      </button>
                    </span>
                  </div>
                  {fiche.economie.gele && (
                    <p className="stat-hint danger-text" style={{ marginBottom: 12 }}>
                      Compte gelé : aucun gain ni dépense possible.
                    </p>
                  )}
                  {fiche.economie.inventaire.length > 0 && (
                    <div className="chips" style={{ marginBottom: 14 }}>
                      {fiche.economie.inventaire.map((i) => (
                        <span className="chip" key={i.item_id}>
                          {i.nom}
                          {i.qty > 1 && <strong>×{i.qty}</strong>}
                        </span>
                      ))}
                    </div>
                  )}
                  {fiche.economie.mouvements.length ? (
                    <div className="table-wrap">
                      <table className="ledger">
                        <tbody>
                          {fiche.economie.mouvements.map((m) => (
                            <tr key={m.id}>
                              <td className="muted nowrap">{depuis(m.ts)}</td>
                              <td>{libelleSource(m.reason)}</td>
                              <td className={`num ${m.amount >= 0 ? "pos" : "neg"}`}>
                                {m.amount >= 0 ? "+" : ""}
                                {formatNombre(m.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">Aucun mouvement.</p>
                  )}
                </div>

                <div className="sheet-block">
                  <h3><Icon name="ticket" /> Tickets ouverts</h3>
                  {fiche.tickets.length ? (
                    <div className="stack">
                      {fiche.tickets.map((t) => (
                        <div className="game-row" key={t.channel_id}>
                          <span className="game-label">#{t.nom}</span>
                          <span className="game-cat">ouvert {depuis(t.cree_le)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Aucun ticket ouvert.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="sheet-block">
                  <h3><Icon name="balance" /> Registre de modération</h3>
                  {fiche.moderation.sanctions.length ? (
                    <div className="stack">
                      {fiche.moderation.sanctions.map((s) => (
                        <div className="rec-item" key={s.id}>
                          <div className="rec-head">
                            <span className={`tag ${s.kind} ${s.active ? "" : "done"}`}>
                              {SANCTION_LABEL[s.kind] || s.kind}
                            </span>
                            <span className="muted">#{s.id}</span>
                            <span className="tl-time">{depuis(s.ts)}</span>
                          </div>
                          <p className="tl-body" style={{ marginTop: 6 }}>
                            {s.reason || <em className="muted">sans motif</em>}
                          </p>
                          <p className="tl-detail">
                            par {s.moderator || "—"}
                            {s.expires_ts && ` · jusqu'au ${dateCourte(s.expires_ts)}`}
                            {!s.active && s.lifted_by && ` · levée par ${s.lifted_by}`}
                          </p>
                          {s.active && s.kind !== "note" && (
                            <div className="rec-foot">
                              <button className="btn small ghost" onClick={() => lever(s.id)}>
                                Lever
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Rien à son dossier. Un ange.</p>
                  )}
                </div>

                <div className="sheet-block">
                  <h3><Icon name="registre" /> Ce qu&apos;on a vu passer</h3>
                  {fiche.journal.length ? (
                    <div className="timeline">
                      {fiche.journal.map((e) => (
                        <div className="tl-row" key={e.id}>
                          <div className="tl-head">
                            <span className="tl-kind">{e.kind_label}</span>
                            <span className="tl-time">{depuis(e.ts)}</span>
                          </div>
                          <div className="tl-body">{e.summary}</div>
                          {e.actor_tag && <div className="tl-detail">par {e.actor_tag}</div>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      Aucun événement journalisé pour ce membre (le journal ne remonte
                      qu&apos;à sa mise en service).
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function FicheEntete({ fiche }: { fiche: Fiche }) {
  const m = fiche.membre;
  const b = fiche.bapteme;
  const exclu = m.timeout_jusqu_a && Date.parse(m.timeout_jusqu_a) > Date.now();

  return (
    <div className="sheet-head">
      {m.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="sheet-avatar" src={m.avatar} alt="" />
      ) : (
        <div className="sheet-avatar empty">{(m.nom || "?").slice(0, 1).toUpperCase()}</div>
      )}
      <div className="sheet-id">
        <h2>{m.nom}</h2>
        <div className="sheet-tag">{m.tag} · {m.id}</div>
        {b?.nom && <div className="sheet-rp">« {b.nom} »</div>}
        <div className="sheet-facts">
          {m.absent && <span className="tag danger">a quitté le serveur</span>}
          {exclu && (
            <span className="tag timeout">
              exclu jusqu&apos;au {dateCourte(m.timeout_jusqu_a)}
            </span>
          )}
          {fiche.economie.gele && <span className="tag danger">compte gelé</span>}
          {fiche.moderation.warns_actifs > 0 && (
            <span className="tag warn">
              {fiche.moderation.warns_actifs} avertissement
              {fiche.moderation.warns_actifs > 1 ? "s" : ""} actif
              {fiche.moderation.warns_actifs > 1 ? "s" : ""}
            </span>
          )}
          {m.boost && <span className="tag gold">booste le serveur</span>}
          {m.anciennete_jours != null && (
            <span className="tag">
              ici depuis {m.anciennete_jours < 60
                ? `${m.anciennete_jours} j`
                : duree(m.anciennete_jours * 1440)}
            </span>
          )}
          {b?.race && <span className="tag">{b.race}</span>}
          {m.roles?.slice(0, 4).map((r) => (
            <span className="tag" key={r.id}>
              <span
                className="role-swatch"
                style={{ background: r.couleur ? `#${r.couleur.toString(16).padStart(6, "0")}` : "currentColor" }}
              />
              {r.nom}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
