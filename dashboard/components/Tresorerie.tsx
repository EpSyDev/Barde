"use client";

// Trésorerie : la contrepartie de l'économie ouverte. Onze sources de gains et un jeu
// web qui crédite, ça finit toujours par produire un compte à 400 000 écus — il faut
// pouvoir le voir, l'arrêter et annuler le mouvement.
//
// Ce que la page NE fait pas : accuser. Un « écart » est un rapport mesuré à la
// médiane, pas un verdict de triche. C'est une invitation à regarder.

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { runAction } from "@/lib/useModuleConfig";
import {
  Stat, FlowBars, Loading, Vide, formatMontant, formatNombre, dateCourte, depuis,
  libelleSource, type Devise,
} from "@/components/ui";

type Masse = { total: number; porteurs: number; moyenne: number; mediane: number; max: number };
type Flux = { entrees: Record<string, number>; sorties: Record<string, number>;
              total_entrees: number; total_sorties: number };
type Gain = { user_id: string; tag: string; gagne: number; mouvements: number };
type Anomalie = Gain & { mediane: number; seuil: number; ratio: number };
type Gele = { user_id: string; tag: string; note: string; ts: string; par: string };

type Tresor = {
  heures: number;
  masse: Masse;
  flux: Flux;
  top_gains: Gain[];
  anomalies: Anomalie[];
  geles: Gele[];
  devise: Devise;
};

type Mouvement = { id: number; from_id: string | null; to_id: string | null;
                   amount: number; reason: string; ts: string };

const FENETRES = [
  { h: 24, label: "24 heures" },
  { h: 168, label: "7 jours" },
  { h: 720, label: "30 jours" },
];

export default function Tresorerie({ aller }: { aller: (id: string, membre?: string) => void }) {
  const [heures, setHeures] = useState(24);
  const [tresor, setTresor] = useState<Tresor | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const toasts = useToasts();

  const charger = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([
        runAction<Tresor>("economie", "tresorerie", { heures }),
        runAction<{ mouvements: Mouvement[]; tags: Record<string, string> }>(
          "economie", "mouvements", { limit: 40 }
        ),
      ]);
      setTresor(t);
      setMouvements(m.mouvements || []);
      setTags(m.tags || {});
      setErreur(null);
    } catch {
      setErreur("La Fripouille est injoignable.");
    }
  }, [heures]);

  useEffect(() => {
    charger();
  }, [charger]);

  const geler = async (userId: string, tag: string, gele: boolean) => {
    const motif = gele
      ? window.prompt(`Geler le compte de ${tag} — motif (visible dans le journal) :`, "gains anormaux")
      : "";
    if (gele && motif === null) return;
    setOccupe(userId);
    try {
      await runAction("economie", "geler", { user_id: userId, gele, note: motif || "" });
      toasts.ok(
        gele ? "Compte gelé" : "Compte dégelé",
        gele ? `${tag} ne gagne ni ne dépense plus rien.` : `${tag} retrouve son économie.`
      );
      await charger();
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    } finally {
      setOccupe(null);
    }
  };

  const annuler = async (mv: Mouvement) => {
    const cible = mv.to_id || mv.from_id || "";
    const ok = window.confirm(
      `Annuler le mouvement #${mv.id} (${mv.amount > 0 ? "+" : ""}${mv.amount}) ?\n\n` +
      "Une écriture inverse sera ajoutée — la ligne d'origine reste visible. " +
      "Le solde peut devenir négatif si les écus ont déjà été dépensés."
    );
    if (!ok) return;
    setOccupe(`tx${mv.id}`);
    try {
      const res = await runAction<{ solde: number }>("economie", "annuler", { id: mv.id });
      toasts.ok("Mouvement annulé", `Nouveau solde de ${tags[cible] || cible} : ${res.solde}.`);
      await charger();
    } catch (e) {
      toasts.err("Annulation refusée", (e as Error).message);
    } finally {
      setOccupe(null);
    }
  };

  if (erreur) return <Vide>{erreur}</Vide>;
  if (!tresor) return <Loading lignes={6} />;

  const { masse, flux, devise } = tresor;
  const inflation = flux.total_entrees - flux.total_sorties;

  return (
    <>
      <div className="tabs">
        {FENETRES.map((f) => (
          <button
            key={f.h}
            className={`tab ${heures === f.h ? "active" : ""}`}
            onClick={() => setHeures(f.h)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <Stat
          icon="coffre"
          label="Masse monétaire"
          value={formatMontant(masse.total, devise)}
          hint={`${formatNombre(masse.porteurs)} comptes approvisionnés`}
        />
        <Stat
          icon="balance"
          label="Médiane"
          value={formatMontant(masse.mediane, devise)}
          hint={`moyenne ${formatMontant(Math.round(masse.moyenne), devise)} · plus riche ${formatMontant(masse.max, devise)}`}
        />
        <Stat
          icon={inflation >= 0 ? "eclair" : "gel"}
          label="Création nette"
          value={`${inflation >= 0 ? "+" : ""}${formatMontant(inflation, devise)}`}
          hint={`${formatMontant(flux.total_entrees, devise)} créés · ${formatMontant(flux.total_sorties, devise)} dépensés`}
        />
        <Stat
          icon="alerte"
          label="Écarts repérés"
          value={formatNombre(tresor.anomalies.length)}
          hint={
            tresor.anomalies.length
              ? "gains très au-dessus de la médiane"
              : "rien d'inhabituel sur la période"
          }
          alert={tresor.anomalies.length > 0}
        />
      </div>

      {tresor.anomalies.length > 0 && (
        <section className="cfg-card" style={{ marginBottom: 20 }}>
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="alerte" /></span>
            <div>
              <h2>Gains hors norme</h2>
              <p>
                Comptes dont les gains dépassent dix fois la médiane sur la fenêtre.
                Un écart n&apos;est pas une triche — c&apos;est un chiffre à expliquer.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Membre</th>
                  <th className="num">Gagné</th>
                  <th className="num">Mouvements</th>
                  <th className="num">× médiane</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tresor.anomalies.map((a) => (
                  <tr key={a.user_id}>
                    <td>
                      <button className="link" onClick={() => aller("membres", a.user_id)}>
                        {a.tag}
                      </button>
                    </td>
                    <td className="num pos">{formatMontant(a.gagne, devise)}</td>
                    <td className="num">{formatNombre(a.mouvements)}</td>
                    <td className="num">
                      <span className="tag danger">×{a.ratio}</span>
                    </td>
                    <td className="actions">
                      <button
                        className="btn small danger"
                        disabled={occupe === a.user_id}
                        onClick={() => geler(a.user_id, a.tag, true)}
                      >
                        <Icon name="gel" /> Geler
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="cfg-grid wide">
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="bourse" /></span>
            <div>
              <h2>Création de monnaie</h2>
              <p>Par source, sur la fenêtre choisie.</p>
            </div>
          </div>
          <FlowBars entries={flux.entrees} total={flux.total_entrees} devise={devise} />
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="coffre" /></span>
            <div>
              <h2>Destruction de monnaie</h2>
              <p>Achats et retraits : ce qui sort du circuit.</p>
            </div>
          </div>
          <FlowBars
            entries={flux.sorties}
            total={flux.total_sorties}
            devise={devise}
            sortant
            vide="Rien n'a été dépensé sur la période — la monnaie s'accumule."
          />
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="personnes" /></span>
            <div>
              <h2>Plus gros gagnants</h2>
              <p>Sur la fenêtre, tous motifs confondus.</p>
            </div>
          </div>
          {tresor.top_gains.length ? (
            <div className="table-wrap">
              <table className="ledger">
                <tbody>
                  {tresor.top_gains.map((g) => (
                    <tr key={g.user_id}>
                      <td>
                        <button className="link" onClick={() => aller("membres", g.user_id)}>
                          {g.tag}
                        </button>
                      </td>
                      <td className="num pos">{formatMontant(g.gagne, devise)}</td>
                      <td className="num muted">{g.mouvements} mvt</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Aucun gain sur la période.</p>
          )}
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="gel" /></span>
            <div>
              <h2>Comptes gelés</h2>
              <p>Ni gain ni dépense tant que le gel dure. Le solde, lui, reste intact.</p>
            </div>
          </div>
          {tresor.geles.length ? (
            <div className="stack">
              {tresor.geles.map((g) => (
                <div className="rec-item" key={g.user_id}>
                  <div className="rec-head">
                    <button className="link" onClick={() => aller("membres", g.user_id)}>
                      {g.tag}
                    </button>
                    <span className="tag danger">gelé</span>
                    <button
                      className="btn small"
                      style={{ marginLeft: "auto" }}
                      disabled={occupe === g.user_id}
                      onClick={() => geler(g.user_id, g.tag, false)}
                    >
                      Dégeler
                    </button>
                  </div>
                  <p className="stat-hint">
                    {g.note || "sans motif"} — par {g.par || "?"}, {depuis(g.ts)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucun compte gelé.</p>
          )}
        </section>
      </div>

      <section className="cfg-card" style={{ marginTop: 20 }}>
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="registre" /></span>
          <div>
            <h2>Derniers mouvements</h2>
            <p>
              Le grand livre, ligne à ligne. Annuler crée une écriture inverse :
              l&apos;original reste visible, l&apos;histoire n&apos;est jamais réécrite.
            </p>
          </div>
        </div>
        {mouvements.length ? (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Quand</th>
                  <th>Motif</th>
                  <th>Membre</th>
                  <th className="num">Montant</th>
                  <th className="actions"></th>
                </tr>
              </thead>
              <tbody>
                {mouvements.map((mv) => {
                  const cible = mv.to_id || mv.from_id || "";
                  const annulation = mv.reason.startsWith("annulation:");
                  return (
                    <tr key={mv.id}>
                      <td className="muted mono">{mv.id}</td>
                      <td className="muted nowrap">{dateCourte(mv.ts)}</td>
                      <td>{libelleSource(mv.reason)}</td>
                      <td>
                        {cible ? (
                          <button className="link" onClick={() => aller("membres", cible)}>
                            {tags[cible] || cible}
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={`num ${mv.amount >= 0 ? "pos" : "neg"}`}>
                        {mv.amount >= 0 ? "+" : ""}
                        {formatMontant(mv.amount, devise)}
                      </td>
                      <td className="actions">
                        {!annulation && (
                          <button
                            className="btn small ghost"
                            disabled={occupe === `tx${mv.id}`}
                            onClick={() => annuler(mv)}
                            title="Créer l'écriture inverse"
                          >
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucun mouvement enregistré.</p>
        )}
      </section>
    </>
  );
}
