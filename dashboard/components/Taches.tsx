"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide, depuis } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";
import { useToasts } from "@/components/Toasts";

type Cfg = { enabled: boolean; channel_id: string | null; role_ids: string[] };
type Statut = "a_faire" | "attribuee" | "terminee";
type Tache = {
  id: string;
  titre: string;
  description: string;
  echeance: string;
  statut: Statut;
  auteur: string | null;
  assigne: string | null;
  cree: string;
  terminee?: string;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon",
  role_ids: "Rôles autorisés",
};
const STATUTS: Record<Statut, string> = { a_faire: "🕓 À faire", attribuee: "✅ Attribuée", terminee: "🏁 Terminée" };

// Seules les clés de réglage partent au bot : la liste des tâches est son état à lui.
const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  role_ids: ((d.role_ids as unknown[]) || []).map(String),
});
const serialize = (c: Cfg) => ({ enabled: c.enabled, channel_id: c.channel_id, role_ids: c.role_ids });

/** Tableau de tâches de l'équipe, piloté depuis un salon Discord. */
export default function Taches() {
  const mod = useModuleConfig<Cfg>("taches", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const toasts = useToasts();
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [filtre, setFiltre] = useState<"ouvertes" | Statut | "toutes">("ouvertes");

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/fripouille/action/taches/liste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) setTaches((await r.json()).taches || []);
    } catch {
      /* le panneau reste utilisable */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, [charger]);

  const supprimer = async (t: Tache) => {
    if (!window.confirm(`Supprimer la tâche « ${t.titre} » (et sa carte sur Discord) ?`)) return;
    const r = await fetch("/api/fripouille/action/taches/supprimer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    });
    if (r.ok) {
      toasts.ok("Tâche supprimée");
      charger();
    } else toasts.err("Suppression impossible");
  };

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const visibles = (taches || []).filter((t) =>
    filtre === "toutes" ? true : filtre === "ouvertes" ? t.statut !== "terminee" : t.statut === filtre
  );
  const compte = (s: Statut) => (taches || []).filter((t) => t.statut === s).length;

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="parchemin" />
          </span>
          <div>
            <h2>Tâches de l&apos;équipe</h2>
            <p>
              Un panneau « ➕ Nouvelle tâche » dans le salon. Chaque tâche devient une carte : on la prend
              (🙋) ou on la confie (👤) ; un récap ✅ est alors posté en réponse, puis 🏁 quand c&apos;est fini.
            </p>
          </div>
        </div>

        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Publier le panneau</span>
        </label>

        <div className="cfg-field">
          <label>Salon des tâches</label>
          <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
        </div>

        <div className="cfg-field">
          <label>Rôles autorisés à créer et attribuer</label>
          {d.role_ids.length > 0 && (
            <div className="chips">
              {d.role_ids.map((rid) => (
                <span className="chip" key={rid}>
                  {roles.find((r) => r.id === rid)?.name || rid}
                  <button onClick={() => mod.patch({ role_ids: d.role_ids.filter((x) => x !== rid) })} title="Retirer">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v && !d.role_ids.includes(v)) mod.patch({ role_ids: [...d.role_ids, v] });
            }}
          >
            <option value="">+ Ajouter un rôle…</option>
            {roles
              .filter((r) => !d.role_ids.includes(r.id))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
          <p className="cfg-hint">
            Vide = tous ceux qui voient le salon. « Je la prends » reste ouvert à tous ; « Terminer » est
            réservé à la personne assignée et aux rôles autorisés.
          </p>
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>📋 Tâches</h2>
          <p>
            {compte("a_faire")} à faire · {compte("attribuee")} en cours · {compte("terminee")} terminée(s)
          </p>
        </div>
        <div className="tabs">
          {(["ouvertes", "a_faire", "attribuee", "terminee", "toutes"] as const).map((f) => (
            <button key={f} className={`tab ${filtre === f ? "active" : ""}`} onClick={() => setFiltre(f)}>
              {f === "ouvertes" ? "En cours" : f === "toutes" ? "Toutes" : STATUTS[f]}
            </button>
          ))}
        </div>
        {taches === null ? (
          <Loading lignes={3} />
        ) : visibles.length === 0 ? (
          <p className="cfg-hint">Aucune tâche ici.</p>
        ) : (
          <div className="tache-list">
            {visibles.map((t) => (
              <div className={`tache-item ${t.statut}`} key={t.id}>
                <div className="tache-main">
                  <div className="tache-titre">
                    <span className="tache-statut">{STATUTS[t.statut]}</span> {t.titre}
                  </div>
                  {t.description && <div className="tache-desc">{t.description}</div>}
                  <div className="tache-meta">
                    {t.assigne ? `👤 ${t.assigne}` : "Personne dessus"}
                    {t.echeance && ` · 📅 ${t.echeance}`}
                    {` · créée par ${t.auteur || "?"} ${depuis(t.cree)}`}
                    {t.statut === "terminee" && t.terminee && ` · finie ${depuis(t.terminee)}`}
                  </div>
                </div>
                <button className="btn icon danger" onClick={() => supprimer(t)} title="Supprimer">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <DirtyBar
        dirty={mod.dirty}
        dirtyKeys={mod.dirtyKeys}
        saving={mod.saving}
        onSave={mod.save}
        onReset={mod.reset}
        labels={LABELS}
      />
    </div>
  );
}
