"use client";

// Briques partagées par les écrans : la barre d'enregistrement, les tuiles de
// chiffres, les barres de répartition, et les formateurs (dates, montants).
// Tout ce qui apparaissait en triple exemplaire dans les composants.

import Icon, { IconName } from "@/components/Icon";

/* ───────────────────────── Formateurs ───────────────────────── */

export function formatNombre(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR").format(n);
}

export type Devise = {
  nom?: string;
  nom_singulier?: string;
  symbole?: string;
  symbole_avant?: boolean;
};

/** Même règle d'affichage que le bot : symbole prioritaire, placé selon la config. */
export function formatMontant(montant: number, devise?: Devise): string {
  const n = formatNombre(montant);
  const symbole = devise?.symbole?.trim();
  if (symbole) return devise?.symbole_avant ? `${symbole} ${n}` : `${n} ${symbole}`;
  const nom = Math.abs(montant) === 1 ? devise?.nom_singulier : devise?.nom;
  return nom ? `${n} ${nom}` : n;
}

const RELATIF = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });
const SEUILS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [2592000, "week"],
];

/** « il y a 3 h » plutôt qu'une date ISO : on lit un flux, pas un journal système. */
export function depuis(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const ecart = (t - Date.now()) / 1000;
  const abs = Math.abs(ecart);
  for (const [limite, unite] of SEUILS) {
    if (abs < limite) {
      const diviseur = limite === 60 ? 1 : limite === 3600 ? 60 : limite === 86400 ? 3600
        : limite === 604800 ? 86400 : 604800;
      return RELATIF.format(Math.round(ecart / diviseur), unite);
    }
  }
  return new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function duree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m}` : `${h} h`;
  }
  const j = Math.round(minutes / 1440);
  return `${j} jour${j > 1 ? "s" : ""}`;
}

/* ───────────────────────── Barre d'enregistrement ─────────────────────────
   Elle n'apparaît que s'il y a quelque chose à perdre, et nomme les champs
   modifiés : on sait ce qu'on s'apprête à consigner. */

export function DirtyBar({
  dirty,
  dirtyKeys,
  saving,
  onSave,
  onReset,
  labels,
}: {
  dirty: boolean;
  dirtyKeys: string[];
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  /** Noms lisibles des clés techniques (ex. `role_id` → « Rôle attribué »). */
  labels?: Record<string, string>;
}) {
  if (!dirty) return null;
  const noms = dirtyKeys.map((k) => labels?.[k] || k);
  const resume =
    noms.length <= 3 ? noms.join(", ") : `${noms.slice(0, 2).join(", ")} et ${noms.length - 2} autres`;

  return (
    <div className="dirty-bar" role="region" aria-label="Modifications non enregistrées">
      <span className="seal" aria-hidden="true">
        <Icon name="plume" />
      </span>
      <div className="dirty-text">
        Modifications non consignées — <em>{resume}</em>
      </div>
      <button className="btn ghost small" onClick={onReset} disabled={saving}>
        Annuler
      </button>
      <button className="btn primary" onClick={onSave} disabled={saving}>
        <Icon name="sceau" />
        {saving ? "Consignation…" : "Consigner"}
      </button>
    </div>
  );
}

/* ───────────────────────── Tuile de chiffre ───────────────────────── */

export function Stat({
  icon,
  label,
  value,
  hint,
  alert,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Passe la tuile en rouge : réservé à ce qui demande une action, pas à l'emphase. */
  alert?: boolean;
}) {
  return (
    <div className={`stat ${alert ? "alert" : ""}`}>
      <div className="stat-label">
        <Icon name={icon} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint != null && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/* ───────────────────────── Barres de répartition ───────────────────────── */

export function FlowBars({
  entries,
  total,
  sortant,
  devise,
  vide,
}: {
  entries: Record<string, number>;
  total: number;
  sortant?: boolean;
  devise?: Devise;
  vide?: string;
}) {
  const lignes = Object.entries(entries).slice(0, 10);
  if (!lignes.length) {
    return <p className="muted">{vide || "Aucun mouvement sur la période."}</p>;
  }
  const max = Math.max(...lignes.map(([, v]) => v), 1);
  return (
    <div className="flow-list">
      {lignes.map(([nom, valeur]) => (
        <div className="flow-row" key={nom}>
          <span className="flow-name" title={nom}>
            {libelleSource(nom)}
          </span>
          <span className={`flow-bar ${sortant ? "out" : ""}`}>
            <i style={{ width: `${Math.max(3, (valeur / max) * 100)}%` }} />
          </span>
          <span className="flow-value">
            {formatMontant(valeur, devise)}
            {total > 0 && (
              <span className="muted"> · {Math.round((valeur / total) * 100)} %</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** `gain:message` → « Message envoyé ». Les motifs inconnus restent affichés bruts. */
export function libelleSource(reason: string): string {
  const CONNUS: Record<string, string> = {
    "gain:message": "Message envoyé",
    "gain:daily": "Récompense quotidienne",
    "gain:reaction": "Réaction",
    "gain:vocal": "Temps en vocal",
    "gain:bienvenue": "Arrivée sur le serveur",
    "gain:bapteme": "Baptême",
    "gain:role_jeu": "Premier rôle-jeu",
    "gain:boost": "Boost du serveur",
    "gain:ticket_resolu": "Ticket résolu",
    "gain:anciennete": "Palier d'ancienneté",
    "gain:seuil_reactions": "Message très réagi",
    dashboard: "Crédit manuel (dashboard)",
  };
  if (CONNUS[reason]) return CONNUS[reason];
  if (reason.startsWith("achat:")) return `Achat — ${reason.slice(6)}`;
  if (reason.startsWith("evenement:")) return `Jeu — ${reason.slice(10)}`;
  if (reason.startsWith("admin:")) return `Admin — ${reason.slice(6)}`;
  if (reason.startsWith("tresorerie:")) return `Trésorerie — ${reason.slice(11)}`;
  if (reason.startsWith("annulation:")) return `Annulation de #${reason.slice(11).split(" ")[0]}`;
  if (reason.startsWith("don")) return "Don entre membres";
  return reason || "—";
}

/* ───────────────────────── États ───────────────────────── */

export function Loading({ lignes = 4 }: { lignes?: number }) {
  return (
    <div className="loading-rows" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: lignes }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width: `${90 - i * 12}%`, height: i === 0 ? 20 : 14 }}
        />
      ))}
    </div>
  );
}

export function Vide({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
