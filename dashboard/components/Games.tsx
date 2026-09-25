"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import TaverneAnnonces from "@/components/TaverneAnnonces";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };
type Game = { id: string; label: string; role_id: string | null; emoji: string };
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
const newGame = (): Game => ({ id: rid(), label: "", role_id: null, emoji: "" });
const newCategory = (): Category => ({
  id: rid(),
  label: "",
  emoji: "",
  description: "",
  placeholder: "",
  games: [newGame()],
});
const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon du menu",
  title: "Titre",
  description: "Description",
  categories: "Catégories de jeux",
};

/** Le brouillon garde les lignes en cours de saisie ; l'envoi, lui, écarte les
 *  catégories sans nom et les jeux sans rôle — inutiles côté bot. */
const serialize = (cfg: JeuxCfg) => ({
  enabled: cfg.enabled,
  channel_id: cfg.channel_id,
  title: cfg.title.trim(),
  description: cfg.description.trim(),
  categories: cfg.categories
    .map((k) => ({
      id: k.id,
      label: k.label.trim(),
      emoji: k.emoji.trim(),
      description: k.description.trim(),
      placeholder: k.placeholder.trim(),
      games: k.games
        .filter((g) => g.label.trim() && g.role_id)
        .map((g) => ({ id: g.id, label: g.label.trim(), role_id: g.role_id, emoji: g.emoji.trim() })),
    }))
    .filter((k) => k.label && k.games.length),
});

const mapGame = (g: Partial<Game>): Game => ({
  id: g.id || rid(),
  label: g.label || "",
  role_id: g.role_id != null ? String(g.role_id) : null,
  emoji: g.emoji || "",
});

const normalize = (raw: Record<string, unknown>): JeuxCfg => {
  // Reprise de l'ancien format (liste plate `games`) → une catégorie unique.
  const brutes = raw.categories as Partial<Category>[] | undefined;
  const plates = raw.games as Partial<Game>[] | undefined;
  let categories: Category[];
  if (Array.isArray(brutes) && brutes.length) {
    categories = brutes.map((c) => ({
      id: c.id || rid(),
      label: c.label || "",
      emoji: c.emoji || "",
      description: c.description || "",
      placeholder: c.placeholder || "",
      games: (c.games || []).map(mapGame),
    }));
  } else if (Array.isArray(plates) && plates.length) {
    categories = [{ ...newCategory(), label: "Jeux", games: plates.map(mapGame) }];
  } else {
    categories = [];
  }
  return {
    enabled: !!raw.enabled,
    channel_id: raw.channel_id != null ? String(raw.channel_id) : null,
    title: String(raw.title || ""),
    description: String(raw.description || ""),
    categories,
  };
};

export default function Games() {
  const mod = useModuleConfig<JeuxCfg>("jeux", normalize, serialize);
  useUnsavedGuard(mod.dirty);

  const [roles, setRoles] = useState<Role[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/fripouille/roles", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { roles: [] })),
      fetch("/api/fripouille/channels", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { channels: [] })),
    ])
      .then(([r, c]) => {
        setRoles(r.roles || []);
        setChannels(c.channels || []);
      })
      .catch(() => undefined);
  }, []);

  const cfg = mod.draft;
  const set = (patch: Partial<JeuxCfg>) => mod.patch(patch);
  const patchCatGames = (cid: string, fn: (games: Game[]) => Game[]) =>
    cfg && mod.setDraft({
      ...cfg,
      categories: cfg.categories.map((k) => (k.id === cid ? { ...k, games: fn(k.games) } : k)),
    });
  const patchCat = (cid: string, patch: Partial<Category>) =>
    cfg && mod.setDraft({
      ...cfg,
      categories: cfg.categories.map((k) => (k.id === cid ? { ...k, ...patch } : k)),
    });
  const patchGame = (cid: string, gid: string, patch: Partial<Game>) =>
    patchCatGames(cid, (games) => games.map((g) => (g.id === gid ? { ...g, ...patch } : g)));

  const save = mod.save;
  const saving = mod.saving;
  const error = mod.error;

  if (mod.loading) return <Loading lignes={6} />;
  if (!cfg) return <Vide>{error || "La Fripouille est injoignable."}</Vide>;

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
                  Jeux ({k.games.length}/25) — emoji optionnel : un emoji classique, ou un
                  emoji perso du serveur au format <code>&lt;:nom:id&gt;</code> (tape{" "}
                  <code>\:nom:</code> dans Discord pour lire l'id).
                </label>
                <div className="game-list">
                  {k.games.map((g) => (
                    <div className="game-row" key={g.id}>
                      <input
                        className="game-emoji"
                        type="text"
                        value={g.emoji}
                        onChange={(e) => patchGame(k.id, g.id, { emoji: e.target.value })}
                        placeholder="😀"
                        title="Emoji du jeu : un emoji classique ou un emoji perso du serveur au format <:nom:id>"
                        aria-label="Emoji du jeu"
                      />
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
            <Icon name="sceau" />
            {saving ? "Publication…" : "Enregistrer & publier"}
          </button>
          {!canSave && (
            <span className="cfg-err">
              Il faut un salon et au moins une catégorie avec un jeu relié à un rôle.
            </span>
          )}
        </div>

        <p className="cfg-hint">
          Chaque jeu attribue son rôle au membre qui le choisit ; un menu ne gère que les
          rôles de sa catégorie. La visibilité des salons se règle côté Discord (donner
          « Voir les salons » au rôle du jeu). Le rôle de La Fripouille doit rester au-dessus
          des rôles-jeux dans la hiérarchie.
        </p>
      </section>

      <TaverneAnnonces />

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
