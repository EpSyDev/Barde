"use client";

// « La Taverne ce soir » : une carte par quartier, son blason et ses chiffres du moment.
// Règle de l'accueil tenue ici aussi : chaque chiffre vient d'une mesure du bot ; une
// source muette fait disparaître sa ligne, jamais d'estimation à la place.

import { useCallback, useEffect, useState } from "react";
import Blason from "@/components/Blason";
import { formatMontant, formatNombre, depuis, type Devise } from "@/components/ui";
import { runAction } from "@/lib/useModuleConfig";
import { QUARTIERS, type QuartierId } from "@/lib/sections";

type Tableau = {
  serveur?: { membres: number };
  vocal?: { total: number };
  tickets?: { ouverts: number; non_pris: number };
  bapteme?: { total: number };
  economie?: { masse: { total: number }; anomalies: number; devise: Devise };
  moderation?: { total_semaine: number };
  journal?: { jour: Record<string, number> };
};
type Ligne = { valeur: string; libelle: string; alerte?: boolean };
type Donnees = {
  tableau: Tableau | null;
  bardes: number | null;
  parties: number | null;
  soiree: { titre: string; debut: string } | null;
  sondages: number | null;
  table: { scene: string; heros: number; presents: number; combat: boolean; round: number } | null;
  garde: { verrou: boolean } | null;
  sante: { ram: number; alertes: number } | null;
  sauvegarde: { date?: string; ok?: boolean } | null;
};

const essai = async <T,>(f: () => Promise<T>): Promise<T | null> => {
  try {
    return await f();
  } catch {
    return null;
  }
};

const CIBLE: Record<QuartierId, string> = {
  salle: "bardes", jeu: "enligne", table: "table", place: "membres", ecus: "economie", ordre: "tickets", atelier: "sante",
};

export default function QuartiersSoir({ tableau, aller }: { tableau: Tableau | null; aller: (id: string) => void }) {
  const [d, setD] = useState<Omit<Donnees, "tableau"> | null>(null);

  const charger = useCallback(async () => {
    const [sante0, enligne, soirees, sondages, table, garde, sante, sauv] = await Promise.all([
      essai(async () => (await fetch("/api/fripouille/health", { cache: "no-store" })).json()),
      essai(() => runAction<{ parties: { terminee: boolean }[] }>("enligne", "etat")),
      essai(() => runAction<{ soirees: { titre: string; debut: string; statut: string }[] }>("soirees", "liste")),
      essai(() => runAction<{ sondages: { statut: string }[] }>("sondages", "liste")),
      essai(() => runAction<{ scene: string; heros: number; presents: number; combat: boolean; round: number }>("plateau", "resume")),
      essai(() => runAction<{ verrou: { actif?: boolean } }>("garde", "etat")),
      essai(() => runAction<{ actuel: { ram_dispo_mo: number } | null; en_alerte: string[] }>("sante", "etat")),
      essai(() => runAction<{ derniere: { date?: string; ok?: boolean } }>("sauvegarde", "etat")),
    ]);
    const prochaine = (soirees?.soirees || [])
      .filter((s) => s.statut === "a_venir")
      .sort((a, b) => a.debut.localeCompare(b.debut))[0];
    setD({
      bardes: sante0?.barde?.en_ligne ? sante0.barde.a_l_antenne ?? 0 : null,
      parties: enligne ? enligne.parties.filter((p) => !p.terminee).length : null,
      soiree: prochaine ? { titre: prochaine.titre, debut: prochaine.debut } : null,
      sondages: sondages ? sondages.sondages.filter((s) => s.statut === "ouvert").length : null,
      table,
      garde: garde ? { verrou: !!garde.verrou?.actif } : null,
      sante: sante?.actuel ? { ram: sante.actuel.ram_dispo_mo, alertes: sante.en_alerte.length } : null,
      sauvegarde: sauv?.derniere ?? null,
    });
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, [charger]);

  const t = tableau;
  const n = (x: number | null | undefined) => formatNombre(x ?? 0);
  const lignes: Record<QuartierId, Ligne[]> = {
    salle: [
      ...(d?.bardes != null ? [{ valeur: n(d.bardes), libelle: "barde(s) à l'antenne" }] : []),
      ...(t?.serveur ? [{ valeur: n(t.serveur.membres), libelle: "habitants" }] : []),
    ],
    jeu: [
      ...(d?.parties != null ? [{ valeur: n(d.parties), libelle: "partie(s) en cours" }] : []),
      ...(d?.soiree ? [{
        valeur: new Date(d.soiree.debut).toLocaleString("fr-FR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        libelle: `soirée · ${d.soiree.titre}`,
      }] : []),
      ...(d?.sondages ? [{ valeur: n(d.sondages), libelle: "sondage(s) ouvert(s)" }] : []),
    ],
    table: d?.table
      ? [
          { valeur: "❦", libelle: d.table.scene ? `scène : ${d.table.scene}` : "aucune scène en place" },
          { valeur: n(d.table.heros), libelle: "héros sur la carte" },
          ...(d.table.combat ? [{ valeur: `round ${d.table.round || 0}`, libelle: "combat en cours", alerte: true }] : []),
          ...(d.table.presents ? [{ valeur: n(d.table.presents), libelle: "à la table en ce moment" }] : []),
        ]
      : [],
    place: [
      ...(t?.vocal ? [{ valeur: n(t.vocal.total), libelle: "en vocal" }] : []),
      ...(t?.journal ? [{ valeur: n(t.journal.jour?.membre_arrivee), libelle: "arrivée(s) en 24 h" }] : []),
    ],
    ecus: [
      ...(t?.economie ? [{ valeur: formatMontant(t.economie.masse.total, t.economie.devise), libelle: "en circulation" }] : []),
      ...(t?.bapteme ? [{ valeur: n(t.bapteme.total), libelle: "baptisés" }] : []),
      ...(t?.economie?.anomalies ? [{ valeur: n(t.economie.anomalies), libelle: "écart(s) de gains à regarder", alerte: true }] : []),
    ],
    ordre: [
      ...(t?.tickets ? [{ valeur: n(t.tickets.non_pris), libelle: "ticket(s) sans personne", alerte: !!t.tickets.non_pris }] : []),
      ...(t?.moderation ? [{ valeur: n(t.moderation.total_semaine), libelle: "sanction(s) en 7 jours" }] : []),
      ...(d?.garde?.verrou ? [{ valeur: "🔒", libelle: "serveur verrouillé", alerte: true }] : []),
    ],
    atelier: [
      ...(d?.sante ? [{ valeur: `${d.sante.ram} Mo`, libelle: "de RAM disponible", alerte: d.sante.alertes > 0 }] : []),
      ...(d?.sauvegarde?.date ? [{ valeur: d.sauvegarde.ok ? "✓" : "✗", libelle: `sauvegarde ${depuis(d.sauvegarde.date)}`, alerte: !d.sauvegarde.ok }] : []),
    ],
  };

  return (
    <section className="soir">
      <div className="soir-tete">
        <h2>Les quartiers ce soir</h2>
        <p>Chaque chiffre est relevé par le bot ; un quartier muet n&apos;affiche rien plutôt qu&apos;une estimation.</p>
      </div>
      <div className="soir-grille">
        {QUARTIERS.map((q, i) => {
          const l = lignes[q.id];
          const alerte = l.some((x) => x.alerte);
          return (
            <button
              key={q.id}
              className={`soir-carte ${alerte ? "alerte" : ""}`}
              style={{ ["--q" as string]: q.couleur, ["--q-fonce" as string]: q.fonce, ["--i" as string]: i }}
              onClick={() => aller(CIBLE[q.id])}
            >
              <span className="soir-blason"><Blason q={q} taille={54} /></span>
              <span className="soir-nom">{q.nom}</span>
              <span className="soir-devise">{q.devise}</span>
              <span className="soir-lignes">
                {l.length === 0 ? (
                  <span className="soir-ligne calme">{d ? "Rien à relever" : "…"}</span>
                ) : (
                  l.map((x) => (
                    <span key={x.libelle} className={`soir-ligne ${x.alerte ? "alerte" : ""}`}>
                      <b>{x.valeur}</b> {x.libelle}
                    </span>
                  ))
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
