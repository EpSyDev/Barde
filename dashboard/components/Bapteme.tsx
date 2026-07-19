"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function Bapteme() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [cfg, setCfg] = useState<BaptemeCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [chRes, cRes] = await Promise.all([
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/config/bapteme", { cache: "no-store" }),
        ]);
        if (!chRes.ok || !cRes.ok) throw new Error();
        const chData = await chRes.json();
        const d = await cRes.json();
        setChannels(chData.channels || []);
        setCfg({
          enabled: !!d.enabled,
          panel_channel_id: d.panel_channel_id != null ? String(d.panel_channel_id) : null,
          event_channel_id: d.event_channel_id != null ? String(d.event_channel_id) : null,
          panel_title: d.panel_title || "",
          panel_description: d.panel_description || "",
          panel_image: d.panel_image || "",
          button_label: d.button_label || "",
          event_message: d.event_message || "",
          event_image: d.event_image || "",
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const set = (patch: Partial<BaptemeCfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/fripouille/config/bapteme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  if (error && !cfg) return <div className="empty-state">{error}</div>;
  if (!cfg || !channels) return <div className="empty-state">Chargement de la config…</div>;

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
            {saving ? "Enregistrement…" : "Enregistrer & publier"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
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
    </div>
  );
}
