"use client";

import { useCallback, useEffect, useState } from "react";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };
type Category = { id: string; name: string };
type Game = {
  id: string;
  label: string;
  emoji: string;
  role_id: string | null;
  category_id: string | null;
};
type JeuxCfg = {
  enabled: boolean;
  channel_id: string | null;
  title: string;
  description: string;
  games: Game[];
};

const newGame = (): Game => ({
  id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8),
  label: "",
  emoji: "",
  role_id: null,
  category_id: null,
});

export default function Games() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [cfg, setCfg] = useState<JeuxCfg | null>(null);
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
          fetch("/api/fripouille/config/jeux", { cache: "no-store" }),
        ]);
        if (!rRes.ok || !chRes.ok || !catRes.ok || !cRes.ok) throw new Error();
        const rData = await rRes.json();
        const chData = await chRes.json();
        const catData = await catRes.json();
        const cData = await cRes.json();
        setRoles(rData.roles || []);
        setChannels(chData.channels || []);
        setCategories(catData.categories || []);
        setCfg({
          enabled: !!cData.enabled,
          channel_id: cData.channel_id != null ? String(cData.channel_id) : null,
          title: cData.title || "",
          description: cData.description || "",
          games: (cData.games || []).map((g: Partial<Game>) => ({
            id: g.id || newGame().id,
            label: g.label || "",
            emoji: g.emoji || "",
            role_id: g.role_id != null ? String(g.role_id) : null,
            category_id: g.category_id != null ? String(g.category_id) : null,
          })),
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const patchGame = (id: string, patch: Partial<Game>) =>
    setCfg((c) =>
      c ? { ...c, games: c.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : c
    );

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const games = cfg.games
        .filter((g) => g.label.trim() && g.role_id)
        .map((g) => ({
          id: g.id,
          label: g.label.trim(),
          emoji: g.emoji.trim(),
          role_id: g.role_id,
          category_id: g.category_id,
        }));
      const res = await fetch("/api/fripouille/config/jeux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          channel_id: cfg.channel_id,
          title: cfg.title.trim(),
          description: cfg.description.trim(),
          games,
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
  if (!cfg || !roles || !channels || !categories)
    return <div className="empty-state">Chargement de la config…</div>;

  const canSave =
    !cfg.enabled ||
    (!!cfg.channel_id && cfg.games.some((g) => g.label.trim() && g.role_id));

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🎮 Rôles-jeux</h2>
          <p>
            Un menu déroulant où chaque membre choisit ses jeux et reçoit le rôle qui
            ouvre l'accès à leurs salons.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Publier le menu</span>
        </label>

        <div className="cfg-field">
          <label htmlFor="chan">Salon du menu</label>
          <select
            id="chan"
            value={cfg.channel_id ?? ""}
            onChange={(e) => setCfg({ ...cfg, channel_id: e.target.value || null })}
          >
            <option value="">— Choisir un salon —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
                {c.category ? ` (${c.category})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="cfg-field">
          <label htmlFor="title">Titre</label>
          <input
            id="title"
            type="text"
            value={cfg.title}
            onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
            placeholder="Choisis tes jeux"
          />
        </div>

        <div className="cfg-field">
          <label htmlFor="desc">Description</label>
          <textarea
            id="desc"
            rows={2}
            value={cfg.description}
            onChange={(e) => setCfg({ ...cfg, description: e.target.value })}
            placeholder="Sélectionne les jeux auxquels tu joues…"
          />
        </div>

        <div className="cfg-field">
          <label>Jeux ({cfg.games.length}/25)</label>
          <div className="game-list">
            {cfg.games.map((g) => (
              <div className="game-row" key={g.id}>
                <input
                  className="game-emoji"
                  type="text"
                  value={g.emoji}
                  onChange={(e) => patchGame(g.id, { emoji: e.target.value })}
                  placeholder="🎯"
                  aria-label="Emoji"
                />
                <input
                  className="game-label"
                  type="text"
                  value={g.label}
                  onChange={(e) => patchGame(g.id, { label: e.target.value })}
                  placeholder="Nom du jeu"
                  aria-label="Nom du jeu"
                />
                <select
                  className="game-role"
                  value={g.role_id ?? ""}
                  onChange={(e) => patchGame(g.id, { role_id: e.target.value || null })}
                  aria-label="Rôle"
                >
                  <option value="">— Rôle —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  className="game-cat"
                  value={g.category_id ?? ""}
                  onChange={(e) => patchGame(g.id, { category_id: e.target.value || null })}
                  aria-label="Catégorie"
                >
                  <option value="">— Catégorie —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn icon danger"
                  onClick={() => setCfg({ ...cfg, games: cfg.games.filter((x) => x.id !== g.id) })}
                  title="Retirer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {cfg.games.length < 25 && (
            <button
              className="btn"
              onClick={() => setCfg({ ...cfg, games: [...cfg.games, newGame()] })}
            >
              + Ajouter un jeu
            </button>
          )}
        </div>

        <div className="cfg-actions">
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            {saving ? "Enregistrement…" : "Enregistrer & publier"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>

        <p className="cfg-hint">
          Si tu lies une <strong>catégorie</strong> à un jeu, le bot la rend privée
          (@everyone perd « Voir les salons ») et l'ouvre au rôle du jeu — tu n'as rien à
          régler à la main. Sans catégorie, seul le rôle est attribué. Le rôle de La
          Fripouille doit rester au-dessus des rôles-jeux.
        </p>
      </section>
    </div>
  );
}
