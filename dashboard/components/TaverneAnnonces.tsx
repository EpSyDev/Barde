"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useModuleConfig } from "@/lib/useModuleConfig";

type Channel = { id: string; name: string; category: string | null };
type Cfg = { enabled: boolean; channel_id: string | null; lien: string; signalement_channel_id: string | null };

/** Annonces Discord de la Taverne 3D (module Fripouille « taverne3d ») : le hub du jeu fait signe
 *  quand un voyageur entre dans une salle vide, cherche des adversaires ou qu'une veillée approche ;
 *  et le salon de modération où tombent les signalements du vocal de proximité. */
export default function TaverneAnnonces() {
  const mod = useModuleConfig<Cfg>("taverne3d", (d) => ({
    enabled: !!d.enabled,
    channel_id: d.channel_id != null ? String(d.channel_id) : null,
    lien: String(d.lien || "https://myrhaven.vercel.app/proto/taverne-3d/"),
    signalement_channel_id: d.signalement_channel_id != null ? String(d.signalement_channel_id) : null,
  }));
  const [channels, setChannels] = useState<Channel[]>([]);
  useEffect(() => {
    fetch("/api/fripouille/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => setChannels(d.channels || []))
      .catch(() => undefined);
  }, []);
  if (mod.loading || !mod.draft) return null;
  const d = mod.draft;

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <span className="cfg-card-icon"><Icon name="cor" /></span>
        <div>
          <h2>Taverne 3D : annonces sur Discord</h2>
          <p>
            Le jeu fait signe quand un voyageur pousse la porte d'une taverne vide (au plus une fois
            par quart d'heure, et toutes les 3 h par joueur), cherche des adversaires (Borgne, Dé menteur,
            palet, marelle), ou quand la veillée du conteur approche (puis son résumé et ses présents).
          </p>
        </div>
      </div>
      <label className="cfg-toggle">
        <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
        <span className="switch" />
        <span>Activer les annonces</span>
      </label>
      <div className="field-2col">
        <div className="cfg-field">
          <label>Salon</label>
          <select value={d.channel_id ?? ""} onChange={(e) => mod.patch({ channel_id: e.target.value || null })}>
            <option value="">— choisir —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.category ? `${c.category} › ` : ""}#{c.name}</option>
            ))}
          </select>
        </div>
        <div className="cfg-field">
          <label>Lien du jeu</label>
          <input type="text" value={d.lien} onChange={(e) => mod.patch({ lien: e.target.value })} />
        </div>
      </div>
      <div className="cfg-field">
        <label>Salon des signalements (vocal de proximité)</label>
        <select value={d.signalement_channel_id ?? ""} onChange={(e) => mod.patch({ signalement_channel_id: e.target.value || null })}>
          <option value="">— aucun (journal du hub seulement) —</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.category ? `${c.category} › ` : ""}#{c.name}</option>
          ))}
        </select>
        <p className="cfg-hint">Un salon privé à la modération : chaque signalement y arrive avec les deux comptes Discord.</p>
      </div>
      {mod.dirty && (
        <button className="btn primary" disabled={mod.saving} onClick={() => mod.save()}>
          {mod.saving ? "Enregistrement…" : "Enregistrer les annonces"}
        </button>
      )}
    </section>
  );
}
