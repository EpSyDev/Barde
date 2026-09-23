"use client";

// Réglages : deux choses qui manquaient et qui ne se voient que le jour où on en a
// besoin — une sauvegarde de la configuration, et la trace de qui a changé quoi.
//
// La config du bot vit dans un seul `config.json` sur une VM sans sauvegarde
// automatique. Un bouton qui le télécharge vaut tous les discours sur la résilience.

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { Loading, Vide, depuis, dateCourte } from "@/components/ui";

type Entree = {
  ts: string;
  module: string;
  acteur: string;
  champs: string[];
  diff: Record<string, { avant: unknown; apres: unknown }>;
};

type Sante = {
  fripouille: {
    en_ligne: boolean; user?: string | null; guild_nom?: string | null;
    membres?: number | null; latence_ms?: number | null; modules?: string[];
    modules_actifs?: string[];
  };
  barde: { en_ligne: boolean; salons?: number; a_l_antenne?: number };
};

/** Rend une valeur de config lisible dans le diff, sans jamais déborder. */
function apercu(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "activé" : "désactivé";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s || "(vide)";
}

export default function Reglages() {
  const [audit, setAudit] = useState<Entree[] | null>(null);
  const [sante, setSante] = useState<Sante | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);
  const toasts = useToasts();

  const charger = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        fetch("/api/fripouille/audit?limit=80", { cache: "no-store" }),
        fetch("/api/fripouille/health", { cache: "no-store" }),
      ]);
      if (!a.ok) throw new Error();
      setAudit((await a.json()).entrees || []);
      if (s.ok) setSante(await s.json());
      setErreur(null);
    } catch {
      setErreur("La Fripouille est injoignable.");
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const telecharger = () => {
    // Passe par une navigation directe : la route renvoie un Content-Disposition.
    window.location.href = "/api/fripouille/backup";
    toasts.info("Sauvegarde en cours", "Le fichier arrive dans tes téléchargements.");
  };

  const restaurer = async (f: File) => {
    let payload: unknown;
    try {
      payload = JSON.parse(await f.text());
    } catch {
      return toasts.err("Fichier illisible", "Ce n'est pas un JSON valide.");
    }
    const modules = (payload as { modules?: Record<string, unknown> })?.modules;
    if (!modules || typeof modules !== "object") {
      return toasts.err("Sauvegarde invalide", "La clé « modules » est absente.");
    }
    const noms = Object.keys(modules);
    const ok = window.confirm(
      `Restaurer ${noms.length} module(s) : ${noms.join(", ")} ?\n\n` +
      "Les valeurs actuelles de ces modules seront écrasées. " +
      "Les modules absents du fichier ne sont pas touchés. " +
      "Chaque modification reste tracée dans le journal ci-dessous."
    );
    if (!ok) return;
    setOccupe(true);
    try {
      const res = await fetch("/api/fripouille/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "restauration refusée");
      toasts.ok("Taverne restaurée", `${(data.restaures || []).length} module(s) rétablis.`);
      charger();
    } catch (e) {
      toasts.err("Échec de la restauration", (e as Error).message);
    } finally {
      setOccupe(false);
      if (fichier.current) fichier.current.value = "";
    }
  };

  if (erreur && !audit) return <Vide>{erreur}</Vide>;
  if (!audit) return <Loading lignes={5} />;

  const f = sante?.fripouille;

  return (
    <>
      <div className="cfg-grid wide">
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="coffre" /></span>
            <div>
              <h2>Sauvegarde de la taverne</h2>
              <p>
                Toute la configuration des modules dans un fichier. La VM n&apos;a pas de
                sauvegarde automatique — c&apos;est le seul filet.
              </p>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn primary" onClick={telecharger}>
              <Icon name="telecharger" /> Télécharger
            </button>
            <button
              className="btn"
              disabled={occupe}
              onClick={() => fichier.current?.click()}
            >
              <Icon name="televerser" /> Restaurer un fichier
            </button>
            <input
              ref={fichier}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) restaurer(file);
              }}
            />
          </div>

          <p className="stat-hint">
            La restauration est additive : elle rétablit les modules présents dans le
            fichier et laisse les autres intacts. Chaque valeur repasse par le filtre du
            schéma du module — un fichier trafiqué n&apos;injecte rien d&apos;inconnu.
          </p>
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="bouclier" /></span>
            <div>
              <h2>État des bots</h2>
              <p>Ce que le panneau arrive à joindre, à l&apos;instant.</p>
            </div>
          </div>

          <div className="table-wrap">
            <table className="ledger">
              <tbody>
                <tr>
                  <td>La Fripouille</td>
                  <td>
                    <span className={`tag ${f?.en_ligne ? "note" : "danger"}`}>
                      {f?.en_ligne ? "joignable" : "muette"}
                    </span>
                  </td>
                  <td className="muted">{f?.user || "—"}</td>
                </tr>
                {f?.en_ligne && (
                  <>
                    <tr>
                      <td>Serveur</td>
                      <td colSpan={2} className="muted">
                        {f.guild_nom || "—"}
                        {f.membres != null && ` · ${f.membres} membres`}
                      </td>
                    </tr>
                    <tr>
                      <td>Latence Discord</td>
                      <td colSpan={2} className="muted mono">
                        {f.latence_ms != null ? `${f.latence_ms} ms` : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td>Modules chargés</td>
                      <td colSpan={2} className="muted">
                        {(f.modules || []).length} — dont{" "}
                        {(f.modules_actifs || []).length} allumés
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <td>Barde (musique)</td>
                  <td>
                    <span className={`tag ${sante?.barde.en_ligne ? "note" : "danger"}`}>
                      {sante?.barde.en_ligne ? "joignable" : "muet"}
                    </span>
                  </td>
                  <td className="muted">
                    {sante?.barde.en_ligne
                      ? `${sante.barde.salons ?? 0} salons · ${sante.barde.a_l_antenne ?? 0} à l'antenne`
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {f?.modules_actifs?.length ? (
            <div className="chips" style={{ marginTop: 14 }}>
              {f.modules_actifs.map((m) => (
                <span className="chip" key={m}>
                  <span className="flame"><Icon name="chandelle" size={13} /></span>
                  {m}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <section className="cfg-card" style={{ marginTop: 20 }}>
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="oeil" /></span>
          <div>
            <h2>Qui a changé quoi</h2>
            <p>
              Vous êtes plusieurs sur ce panneau. Chaque modification garde son auteur et
              la valeur d&apos;avant — les 400 dernières.
            </p>
          </div>
        </div>

        {audit.length ? (
          <div className="timeline">
            {audit.map((e, i) => (
              <div className="tl-row" key={`${e.ts}-${i}`}>
                <div className="tl-head">
                  <span className="tl-kind">{e.module}</span>
                  <span className="muted">{e.acteur}</span>
                  <span className="tl-time" title={dateCourte(e.ts)}>{depuis(e.ts)}</span>
                </div>
                <div className="tl-body">
                  {e.champs.length} champ{e.champs.length > 1 ? "s" : ""} modifié
                  {e.champs.length > 1 ? "s" : ""} : {e.champs.join(", ")}
                </div>
                <div className="tl-detail">
                  {Object.entries(e.diff)
                    .slice(0, 4)
                    .map(([champ, v]) => (
                      <div key={champ}>
                        <strong>{champ}</strong> : {apercu(v.avant)} → {apercu(v.apres)}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            Aucune modification enregistrée depuis la mise en service de l&apos;audit.
          </p>
        )}
      </section>
    </>
  );
}
