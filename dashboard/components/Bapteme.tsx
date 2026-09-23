"use client";


import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import MediaPicker from "@/components/MediaPicker";

type Channel = { id: string; name: string; category: string | null };
type BaptemeCfg = {
  enabled: boolean;
  panel_channel_id: string | null;
  event_channel_id: string | null;
  panel_title: string;
  panel_description: string;
  panel_image: string;
  button_label: string;
  event_message: string;
  event_image: string;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  panel_channel_id: "Salon du panneau",
  event_channel_id: "Salon d'annonce",
  panel_title: "Titre du panneau",
  panel_description: "Description du panneau",
  panel_image: "Image du panneau",
  button_label: "Libellé du bouton",
  event_message: "Message d'annonce",
  event_image: "Image de l'annonce",
};

export default function Bapteme() {
  const mod = useModuleConfig<BaptemeCfg>("bapteme", (d) => ({
    enabled: !!d.enabled,
    panel_channel_id: d.panel_channel_id != null ? String(d.panel_channel_id) : null,
    event_channel_id: d.event_channel_id != null ? String(d.event_channel_id) : null,
    panel_title: String(d.panel_title || ""),
    panel_description: String(d.panel_description || ""),
    panel_image: String(d.panel_image || ""),
    button_label: String(d.button_label || ""),
    event_message: String(d.event_message || ""),
    event_image: String(d.event_image || ""),
  }));
  useUnsavedGuard(mod.dirty);

  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    fetch("/api/fripouille/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => setChannels(d.channels || []))
      .catch(() => undefined);
  }, []);

  const cfg = mod.draft;
  const set = (patch: Partial<BaptemeCfg>) => mod.patch(patch);
  const save = mod.save;
  const saving = mod.saving;

  if (mod.loading) return <Loading lignes={5} />;
  if (!cfg) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const chanOpts = (
    <>
      <option value="">— Choisir un salon —</option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.name}
          {c.category ? ` (${c.category})` : ""}
        </option>
      ))}
    </>
  );

  const canSave = !cfg.enabled || !!cfg.panel_channel_id;

  return (
    <div className="cfg-grid">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🕯️ Baptême</h2>
          <p>
            Un panneau à bouton : le membre choisit sa race, son tempérament puis sa police, le
            bot lui génère un nom (des millions de combinaisons), le pose en pseudo stylisé et
            annonce l'événement.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Publier le panneau de baptême</span>
        </label>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon du panneau</label>
            <select
              value={cfg.panel_channel_id ?? ""}
              onChange={(e) => set({ panel_channel_id: e.target.value || null })}
            >
              {chanOpts}
            </select>
          </div>
          <div className="cfg-field">
            <label>Salon d'événement (annonce du baptême)</label>
            <select
              value={cfg.event_channel_id ?? ""}
              onChange={(e) => set({ event_channel_id: e.target.value || null })}
            >
              {chanOpts}
            </select>
          </div>
        </div>

        <div className="cfg-field">
          <label>Titre du panneau</label>
          <input
            type="text"
            value={cfg.panel_title}
            onChange={(e) => set({ panel_title: e.target.value })}
            placeholder="Le Baptême du Voyageur"
          />
        </div>
        <div className="cfg-field">
          <label>Description du panneau</label>
          <textarea
            rows={2}
            value={cfg.panel_description}
            onChange={(e) => set({ panel_description: e.target.value })}
          />
        </div>
        <div className="cfg-field">
          <label>Image du panneau</label>
          <MediaPicker value={cfg.panel_image} onChange={(v) => set({ panel_image: v })} />
        </div>
        <div className="cfg-field">
          <label>Libellé du bouton</label>
          <input
            type="text"
            value={cfg.button_label}
            onChange={(e) => set({ button_label: e.target.value })}
            placeholder="Se faire baptiser"
          />
        </div>

        <div className="cfg-field">
          <label>Message d'événement (salon d'annonce)</label>
          <textarea
            rows={2}
            value={cfg.event_message}
            onChange={(e) => set({ event_message: e.target.value })}
            placeholder="🕯️ Un nouveau voyageur est baptisé : {name} !"
          />
          <p className="cfg-hint">
            Variables : <code>{"{name}"}</code> (stylisé), <code>{"{name_plain}"}</code>{" "}
            (lisible), <code>{"{mention}"}</code> (le membre — non pingué par défaut).
            <br />
            Pour un nom <strong>plus gros et à la ligne</strong>, mets-le seul sur sa ligne
            avec un dièse : <code># {"{name}"}</code> (très grand), <code>## {"{name}"}</code>{" "}
            (grand). Ex. :<br />
            <code>🕯️ Un nouveau voyageur est baptisé !</code><br />
            <code># {"{name}"}</code>
          </p>
        </div>
        <div className="cfg-field">
          <label>Image de l'annonce</label>
          <MediaPicker value={cfg.event_image} onChange={(v) => set({ event_image: v })} />
          <p className="cfg-hint">Grande image sous le message d'annonce. Vide = texte seul.</p>
        </div>

        <div className="cfg-actions">
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            <Icon name="sceau" />
            {saving ? "Publication…" : "Enregistrer & publier"}
          </button>
          {!canSave && (
            <span className="cfg-err">Choisis le salon du panneau avant de publier.</span>
          )}
        </div>

        <p className="cfg-hint">
          Les races, origines et tempéraments (et leurs millions de combinaisons de noms) sont
          gérés dans le code (fichier <code>bapteme_data.py</code>) — univers fantasy, 10 races,
          chacune avec ses origines (sous-catégories), 12 tempéraments, noms genrés, et une foi
          (voie de quête). Parcours : race → genre → origine → tempérament → foi → police. Le membre choisit sa police (cursive, gothique,
          petites capitales…) ; le nom devient son <strong>pseudo serveur stylisé</strong>. La
          Fripouille doit avoir « Gérer les pseudos » et son rôle au-dessus du membre (elle ne
          peut jamais renommer le propriétaire du serveur — limite Discord).
        </p>
      </section>

      <DirtyBar
        dirty={mod.dirty}
        dirtyKeys={mod.dirtyKeys}
        saving={saving}
        onSave={save}
        onReset={mod.reset}
        labels={LABELS}
      />
    </div>
  );
}
