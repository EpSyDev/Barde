"use client";

import { useCallback, useEffect, useState } from "react";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };
type Game = { id: string; label: string; role_id: string | null };
type Category = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  placeholder: string;
  games: Game[];
};
type JeuxCfg = {
  enabled: boolean;
  channel_id: string | null;
  title: string;
  description: string;
  categories: Category[];
};

const rid = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8);
const newGame = (): Game => ({ id: rid(), label: "", role_id: null });
const newCategory = (): Category => ({
  id: rid(),
  label: "",
  emoji: "",
  description: "",
  placeholder: "",
  games: [newGame()],
});

export default function Games() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [cfg, setCfg] = useState<JeuxCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rRes, chRes, cRes] = await Promise.all([
          fetch("/api/fripouille/roles", { cache: "no-store" }),
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/config/jeux", { cache: "no-store" }),
        ]);
        if (!rRes.ok || !chRes.ok || !cRes.ok) throw new Error();
        const rData = await rRes.json();
        const chData = await chRes.json();
        const cData = await cRes.json();
        setRoles(rData.roles || []);
        setChannels(chData.channels || []);

        const mapGame = (g: Partial<Game>): Game => ({
          id: g.id || rid(),
          label: g.label || "",
          role_id: g.role_id != null ? String(g.role_id) : null,
        });
        // Reprise de l'ancien format (liste plate `games`) → une catégorie unique.
        let categories: Category[];
        if (Array.isArray(cData.categories) && cData.categories.length) {
          categories = cData.categories.map((c: Partial<Category>) => ({
            id: c.id || rid(),
            label: c.label || "",
            emoji: c.emoji || "",
            description: c.description || "",
            placeholder: c.placeholder || "",
            games: (c.games || []).map(mapGame),
          }));
        } else if (Array.isArray(cData.games) && cData.games.length) {
          categories = [
            { ...newCategory(), label: "Jeux", games: cData.games.map(mapGame) },
          ];
        } else {
          categories = [];
        }

        setCfg({
          enabled: !!cData.enabled,
          channel_id: cData.channel_id != null ? String(cData.channel_id) : null,
          title: cData.title || "",
          description: cData.description || "",
          categories,
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const set = (patch: Partial<JeuxCfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const patchCat = (cid: string, patch: Partial<Category>) =>
    setCfg((c) =>
      c ? { ...c, categories: c.categories.map((k) => (k.id === cid ? { ...k, ...patch } : k)) } : c
    );
  const patchGame = (cid: string, gid: string, patch: Partial<Game>) =>
    patchCatGames(cid, (games) => games.map((g) => (g.id === gid ? { ...g, ...patch } : g)));
  const patchCatGames = (cid: string, fn: (games: Game[]) => Game[]) =>
    setCfg((c) =>
      c
        ? { ...c, categories: c.categories.map((k) => (k.id === cid ? { ...k, games: fn(k.games) } : k)) }
        : c
    );

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const categories = cfg.categories
        .map((k) => ({
          id: k.id,
          label: k.label.trim(),
          emoji: k.emoji.trim(),
          description: k.description.trim(),
          placeholder: k.placeholder.trim(),
          games: k.games
            .filter((g) => g.label.trim() && g.role_id)
            .map((g) => ({ id: g.id, label: g.label.trim(), role_id: g.role_id })),
        }))
        .filter((k) => k.label && k.games.length);
      const res = await fetch("/api/fripouille/config/jeux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          channel_id: cfg.channel_id,
          title: cfg.title.trim(),
          description: cfg.description.trim(),
          categories,
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
  if (!cfg || !roles || !channels)
    return <div className="empty-state">Chargement de la config…</div>;

  const validCats = cfg.categories.filter(
    (k) => k.label.trim() && k.games.some((g) => g.label.trim() && g.role_id)
  );
  const canSave = !cfg.enabled || (!!cfg.channel_id && validCats.length > 0);

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🎮 Rôles-jeux</h2>
          <p>
            Range tes jeux en catégories (FPS, MMORPG, Simulation…). Chaque catégorie est
            postée avec son propre menu déroulant ; le membre y coche ses jeux et reçoit les
            rôles qui ouvrent l'accès à leurs salons.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Publier les menus</span>
        </label>

        <div className="cfg-field">
          <label>Salon des menus</label>
          <select
            value={cfg.channel_id ?? ""}
            onChange={(e) => set({ channel_id: e.target.value || null })}
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

        <div className="field-2col">
          <div className="cfg-field">
            <label>Titre d'intro (optionnel)</label>
            <input
              type="text"
              value={cfg.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Bienvenue sur le serveur !"
            />
          </div>
          <div className="cfg-field">
            <label>Description d'intro (optionnel)</label>
            <input
              type="text"
              value={cfg.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Choisis tes jeux pour débloquer leurs salons."
            />
          </div>
        </div>

        <div className="cfg-field">
          <label>Catégories ({cfg.categories.length})</label>
          <p className="cfg-hint">
            Chaque catégorie = un bloc (en-tête + menu déroulant), avec jusqu'à 25 jeux.
          </p>

          <div className="rec-list">
            {cfg.categories.map((k) => (
              <div className="reason-item" key={k.id}>
                <div className="reason-head">
                  <input
                    className="game-emoji"
                    type="text"
                    value={k.emoji}
                    onChange={(e) => patchCat(k.id, { emoji: e.target.value })}
                    placeholder="🎯"
                    aria-label="Emoji de la catégorie"
                  />
                  <input
                    className="game-label"
                    type="text"
                    value={k.label}
                    onChange={(e) => patchCat(k.id, { label: e.target.value })}
                    placeholder="Nom de la catégorie (ex. FPS, MMORPG, Simulation)"
                    aria-label="Nom de la catégorie"
                  />
                  <button
                    className="btn icon danger"
                    onClick={() => set({ categories: cfg.categories.filter((x) => x.id !== k.id) })}
                    title="Supprimer la catégorie"
                  >
                    ✕
                  </button>
                </div>

                <div className="field-2col">
                  <div className="cfg-field">
                    <label>Description (sous l'en-tête)</label>
                    <input
                      type="text"
                      value={k.description}
                      onChange={(e) => patchCat(k.id, { description: e.target.value })}
                      placeholder="Choisis tes FPS favoris"
                    />
                  </div>
                  <div className="cfg-field">
                    <label>Texte du menu (placeholder)</label>
                    <input
                      type="text"
                      value={k.placeholder}
                      onChange={(e) => patchCat(k.id, { placeholder: e.target.value })}
                      placeholder="Sélectionner vos FPS…"
                    />
                  </div>
                </div>

                <label className="cfg-hint" style={{ marginTop: 4 }}>
                  Jeux ({k.games.length}/25)
                </label>
                <div className="game-list">
                  {k.games.map((g) => (
                    <div className="game-row" key={g.id}>
                      <input
                        className="game-label"
                        type="text"
                        value={g.label}
                        onChange={(e) => patchGame(k.id, g.id, { label: e.target.value })}
                        placeholder="Nom du jeu"
                        aria-label="Nom du jeu"
                      />
                      <select
                        className="game-role"
                        value={g.role_id ?? ""}
                        onChange={(e) => patchGame(k.id, g.id, { role_id: e.target.value || null })}
                        aria-label="Rôle"
                      >
                        <option value="">— Rôle —</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn icon danger"
                        onClick={() => patchCatGames(k.id, (games) => games.filter((x) => x.id !== g.id))}
                        title="Retirer le jeu"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                {k.games.length < 25 && (
                  <button
                    className="btn"
                    onClick={() => patchCatGames(k.id, (games) => [...games, newGame()])}
                  >
                    + Ajouter un jeu
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            className="btn"
            onClick={() => set({ categories: [...cfg.categories, newCategory()] })}
          >
            + Ajouter une catégorie
          </button>
        </div>

        <div className="cfg-actions">
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            {saving ? "Enregistrement…" : "Enregistrer & publier"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>

        <p className="cfg-hint">
          Chaque jeu attribue son rôle au membre qui le choisit ; un menu ne gère que les
          rôles de sa catégorie. La visibilité des salons se règle côté Discord (donner
          « Voir les salons » au rôle du jeu). Le rôle de La Fripouille doit rester au-dessus
          des rôles-jeux dans la hiérarchie.
        </p>
      </section>
    </div>
  );
}
