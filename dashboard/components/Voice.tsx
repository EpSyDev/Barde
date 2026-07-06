"use client";

import { useCallback, useEffect, useState } from "react";

type VoiceChannel = { id: string; name: string; category: string | null };
type Category = { id: string; name: string };
type VoiceCfg = {
  enabled: boolean;
  hub_channel_id: string | null;
  category_id: string | null;
  name_template: string;
  user_limit: number;
};

export default function Voice() {
  const [channels, setChannels] = useState<VoiceChannel[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [cfg, setCfg] = useState<VoiceCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [chRes, catRes, cRes] = await Promise.all([
          fetch("/api/fripouille/voice-channels", { cache: "no-store" }),
          fetch("/api/fripouille/categories", { cache: "no-store" }),
          fetch("/api/fripouille/config/tempvoice", { cache: "no-store" }),
        ]);
        if (!chRes.ok || !catRes.ok || !cRes.ok) throw new Error();
        const chData = await chRes.json();
        const catData = await catRes.json();
        const d = await cRes.json();
        setChannels(chData.channels || []);
        setCategories(catData.categories || []);
        setCfg({
          enabled: !!d.enabled,
          hub_channel_id: d.hub_channel_id != null ? String(d.hub_channel_id) : null,
          category_id: d.category_id != null ? String(d.category_id) : null,
          name_template: d.name_template || "Salon de {name}",
          user_limit: Number(d.user_limit) || 0,
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const set = (patch: Partial<VoiceCfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/fripouille/config/tempvoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          hub_channel_id: cfg.hub_channel_id,
          category_id: cfg.category_id,
          name_template: cfg.name_template.trim() || "Salon de {name}",
          user_limit: Math.max(0, Math.min(99, cfg.user_limit)),
        }),
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
  if (!cfg || !channels || !categories)
    return <div className="empty-state">Chargement de la config…</div>;

  const canSave = !cfg.enabled || !!cfg.hub_channel_id;

  return (
    <div className="cfg-grid">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🔊 Salons vocaux temporaires</h2>
          <p>
            Un salon « hub » que les membres rejoignent pour se créer un salon vocal perso,
            supprimé automatiquement une fois vide.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Activer les salons temporaires</span>
        </label>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon « hub » (à rejoindre pour créer)</label>
            <select
              value={cfg.hub_channel_id ?? ""}
              onChange={(e) => set({ hub_channel_id: e.target.value || null })}
            >
              <option value="">— Choisir un salon vocal —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  🔊 {c.name}
                  {c.category ? ` (${c.category})` : ""}
                </option>
              ))}
            </select>
            <p className="cfg-hint">
              Crée un salon vocal nommé p.ex. « ➕ Créer un salon » et choisis-le ici.
            </p>
          </div>
          <div className="cfg-field">
            <label>Catégorie des salons créés</label>
            <select
              value={cfg.category_id ?? ""}
              onChange={(e) => set({ category_id: e.target.value || null })}
            >
              <option value="">— Celle du hub par défaut —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Nom du salon créé</label>
            <input
              type="text"
              value={cfg.name_template}
              onChange={(e) => set({ name_template: e.target.value })}
              placeholder="Salon de {name}"
            />
            <p className="cfg-hint">
              Variable : <code>{"{name}"}</code> = pseudo du membre.
            </p>
          </div>
          <div className="cfg-field">
            <label>Limite de places par défaut</label>
            <input
              type="number"
              min={0}
              max={99}
              value={cfg.user_limit}
              onChange={(e) => set({ user_limit: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
            />
            <p className="cfg-hint">0 = illimité. Le propriétaire peut l'ajuster ensuite.</p>
          </div>
        </div>

        <div className="cfg-actions">
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>

        <p className="cfg-hint">
          Le créateur reçoit « Gérer le salon » sur son salon : il le renomme, change la
          limite de places ou le verrouille directement depuis Discord. La Fripouille doit
          avoir « Gérer les salons » et « Déplacer les membres », son rôle placé au-dessus
          dans la hiérarchie.
        </p>
      </section>
    </div>
  );
}
