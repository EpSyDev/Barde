"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";

type Cfg = { enabled: boolean; channel_id: string | null; jour: number; heure: string };
type Apercu = { titre: string; rubriques: { nom: string; valeur: string }[] };

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const LABELS: Record<string, string> = { enabled: "Activation", channel_id: "Salon", jour: "Jour", heure: "Heure" };

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  jour: Number(d.jour ?? 6),
  heure: typeof d.heure === "string" && /^\d{2}:\d{2}$/.test(d.heure) ? d.heure : "18:00",
});
const serialize = (c: Cfg) => c;

async function action(nom: string) {
  const r = await fetch(`/api/fripouille/action/chronique/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

/** Récap hebdomadaire factuel posté dans le salon du scribe. */
export default function Chronique() {
  const mod = useModuleConfig<Cfg>("chronique", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { channels } = useGuildRefs();
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  if (mod.loading) return <Loading lignes={4} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const voir = async () => {
    setOccupe(true);
    setNote(null);
    try {
      setApercu(await action("apercu"));
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
    }
  };
  const publier = async () => {
    if (!window.confirm("Publier la chronique maintenant dans le salon ?")) return;
    setOccupe(true);
    try {
      await action("publier");
      setNote("✅ Chronique publiée.");
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="parchemin" />
          </span>
          <div>
            <h2>La chronique de la semaine</h2>
            <p>
              Un récap des 7 derniers jours, uniquement avec des chiffres mesurés : arrivées, activité, vocal, jeux, catégories,
              soirées. Les rubriques sans donnée sont omises.
            </p>
          </div>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Publier automatiquement chaque semaine</span>
        </label>
        <div className="cfg-field">
          <label>Salon</label>
          <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
        </div>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Jour</label>
            <select value={d.jour} onChange={(e) => mod.patch({ jour: Number(e.target.value) })}>
              {JOURS.map((j, i) => (
                <option key={j} value={i}>{j}</option>
              ))}
            </select>
          </div>
          <div className="cfg-field">
            <label>Heure (Paris)</label>
            <input type="time" value={d.heure} onChange={(e) => mod.patch({ heure: e.target.value || "18:00" })} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" disabled={occupe} onClick={voir}>👁️ Aperçu</button>
          <button className="btn primary" type="button" disabled={occupe || !d.channel_id || mod.dirty} onClick={publier}>📜 Publier maintenant</button>
        </div>
        {note && <p className="cfg-hint">{note}</p>}
      </section>

      {apercu && (
        <section className="cfg-card">
          <div className="cfg-card-head">
            <h2>{apercu.titre}</h2>
            <p>Aperçu de ce qui serait publié maintenant.</p>
          </div>
          {apercu.rubriques.length === 0 ? (
            <p className="cfg-hint">Une semaine bien calme : rien à consigner.</p>
          ) : (
            apercu.rubriques.map((r) => (
              <div className="cfg-field" key={r.nom}>
                <label>{r.nom}</label>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {r.valeur
                    .replace(/<t:(\d+):\w>/g, (_, s) => new Date(Number(s) * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))
                    .split(/(\*\*[^*]+\*\*)/g)
                    .map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
