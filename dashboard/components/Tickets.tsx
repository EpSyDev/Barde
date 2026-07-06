"use client";

import { useCallback, useEffect, useState } from "react";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };
type Category = { id: string; name: string };
type Reason = { id: string; label: string; emoji: string; intro: string };
type TicketsCfg = {
  enabled: boolean;
  panel_channel_id: string | null;
  category_id: string | null;
  staff_role_id: string | null;
  log_channel_id: string | null;
  panel_title: string;
  panel_description: string;
  button_label: string;
  open_message: string;
  ping_staff: boolean;
  delete_on_close: boolean;
  reasons: Reason[];
};

const newReason = (): Reason => ({
  id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8),
  label: "",
  emoji: "",
  intro: "",
});

export default function Tickets() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [cfg, setCfg] = useState<TicketsCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rRes, chRes, catRes, cRes] = await Promise.all([
          fetch("/api/fripouille/roles", { cache: "no-store" }),
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/categories", { cache: "no-store" }),
          fetch("/api/fripouille/config/tickets", { cache: "no-store" }),
        ]);
        if (!rRes.ok || !chRes.ok || !catRes.ok || !cRes.ok) throw new Error();
        const rData = await rRes.json();
        const chData = await chRes.json();
        const catData = await catRes.json();
        const d = await cRes.json();
        setRoles(rData.roles || []);
        setChannels(chData.channels || []);
        setCategories(catData.categories || []);
        setCfg({
          enabled: !!d.enabled,
          panel_channel_id: d.panel_channel_id != null ? String(d.panel_channel_id) : null,
          category_id: d.category_id != null ? String(d.category_id) : null,
          staff_role_id: d.staff_role_id != null ? String(d.staff_role_id) : null,
          log_channel_id: d.log_channel_id != null ? String(d.log_channel_id) : null,
          panel_title: d.panel_title || "",
          panel_description: d.panel_description || "",
          button_label: d.button_label || "",
          open_message: d.open_message || "",
          ping_staff: d.ping_staff !== false,
          delete_on_close: d.delete_on_close !== false,
          reasons: (d.reasons || []).map((r: Partial<Reason>) => ({
            id: r.id || newReason().id,
            label: r.label || "",
            emoji: r.emoji || "",
            intro: r.intro || "",
          })),
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const set = (patch: Partial<TicketsCfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const patchReason = (id: string, patch: Partial<Reason>) =>
    setCfg((c) =>
      c ? { ...c, reasons: c.reasons.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : c
    );

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const reasons = cfg.reasons
        .filter((r) => r.label.trim())
        .map((r) => ({ id: r.id, label: r.label.trim(), emoji: r.emoji.trim(), intro: r.intro }));
      const res = await fetch("/api/fripouille/config/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, reasons }),
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
  if (!cfg || !roles || !channels || !categories)
    return <div className="empty-state">Chargement de la config…</div>;

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

  const canSave =
    !cfg.enabled || (!!cfg.panel_channel_id && !!cfg.category_id && !!cfg.staff_role_id);

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🎫 Tickets</h2>
          <p>Panneau à bouton → salon privé membre + staff, avec prise en charge et archivage.</p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Publier le panneau de tickets</span>
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
            <label>Catégorie des tickets</label>
            <select
              value={cfg.category_id ?? ""}
              onChange={(e) => set({ category_id: e.target.value || null })}
            >
              <option value="">— Choisir une catégorie —</option>
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
            <label>Rôle staff</label>
            <select
              value={cfg.staff_role_id ?? ""}
              onChange={(e) => set({ staff_role_id: e.target.value || null })}
            >
              <option value="">— Choisir un rôle —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cfg-field">
            <label>Salon d'archive (transcripts)</label>
            <select
              value={cfg.log_channel_id ?? ""}
              onChange={(e) => set({ log_channel_id: e.target.value || null })}
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
            placeholder="Besoin d'aide ?"
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
          <label>Message d'ouverture d'un ticket</label>
          <textarea
            rows={2}
            value={cfg.open_message}
            onChange={(e) => set({ open_message: e.target.value })}
            placeholder="Bonjour {mention} ! Décris ta demande…"
          />
          <p className="cfg-hint">
            Variables : <code>{"{mention}"}</code>, <code>{"{name}"}</code>. Utilisé si le
            motif choisi n'a pas son propre message.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.ping_staff}
            onChange={(e) => set({ ping_staff: e.target.checked })}
          />
          <span className="switch" />
          <span>Ping le staff à l'ouverture</span>
        </label>
        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.delete_on_close}
            onChange={(e) => set({ delete_on_close: e.target.checked })}
          />
          <span className="switch" />
          <span>Supprimer le salon à la fermeture (recommandé)</span>
        </label>

        <div className="cfg-field">
          <label>Motifs (menu déroulant) — optionnel</label>
          <p className="cfg-hint">
            Sans motif : un simple bouton « {cfg.button_label || "Ouvrir un ticket"} ». Avec
            motifs : un menu déroulant, chaque motif ayant son message d'accueil.
          </p>
          <div className="rec-list">
            {cfg.reasons.map((r) => (
              <div className="reason-item" key={r.id}>
                <div className="reason-head">
                  <input
                    className="game-emoji"
                    type="text"
                    value={r.emoji}
                    onChange={(e) => patchReason(r.id, { emoji: e.target.value })}
                    placeholder="🎯"
                    aria-label="Emoji"
                  />
                  <input
                    className="game-label"
                    type="text"
                    value={r.label}
                    onChange={(e) => patchReason(r.id, { label: e.target.value })}
                    placeholder="Nom du motif (ex. Support, Bug, Partenariat)"
                    aria-label="Motif"
                  />
                  <button
                    className="btn icon danger"
                    onClick={() => set({ reasons: cfg.reasons.filter((x) => x.id !== r.id) })}
                    title="Retirer"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={r.intro}
                  onChange={(e) => patchReason(r.id, { intro: e.target.value })}
                  placeholder="Message d'accueil de ce motif (variables {mention}, {name})…"
                />
              </div>
            ))}
          </div>
          {cfg.reasons.length < 25 && (
            <button className="btn" onClick={() => set({ reasons: [...cfg.reasons, newReason()] })}>
              + Ajouter un motif
            </button>
          )}
        </div>

        {!cfg.reasons.length && (
          <div className="cfg-field">
            <label>Libellé du bouton</label>
            <input
              type="text"
              value={cfg.button_label}
              onChange={(e) => set({ button_label: e.target.value })}
              placeholder="Ouvrir un ticket"
            />
          </div>
        )}

        <div className="cfg-actions">
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            {saving ? "Enregistrement…" : "Enregistrer & publier"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>

        <p className="cfg-hint">
          Archivage : à la fermeture, le transcript est envoyé en fichier dans le salon
          d'archive (stocké par Discord, rien sur le serveur), puis le salon est supprimé —
          ce qui évite d'atteindre le plafond de 500 salons du serveur. La Fripouille doit
          avoir « Gérer les salons », et son rôle au-dessus dans la hiérarchie.
        </p>
      </section>
    </div>
  );
}
