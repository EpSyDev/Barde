"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { useToasts } from "@/components/Toasts";
import { ChannelSelect } from "@/components/Mentions";
import TaverneAnnonces from "@/components/TaverneAnnonces";
import TaverneVeillee from "@/components/TaverneVeillee";
import TaverneTesteurs from "@/components/TaverneTesteurs";

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
const normNom = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const hex = (c: number) => (c ? `#${c.toString(16).padStart(6, "0")}` : "#99aab5");
const CAT_PALETTE = ["#e67e22", "#3498db", "#9b59b6", "#2ecc71", "#e74c3c", "#1abc9c", "#f1c40f", "#e91e63", "#546e7a", "#00bcd4"];

/** « 🎯 Valorant » → { emoji: "🎯", label: "Valorant" } (emoji perso <:nom:id> compris). */
function parseLigne(ligne: string): { emoji: string; label: string } {
  const t = ligne.trim();
  const m = /^(<a?:\w+:\d+>|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u.exec(t);
  return m ? { emoji: m[1], label: m[2].trim() } : { emoji: "", label: t };
}

/** URL de l'image d'un emoji perso Discord (<:nom:id> / <a:nom:id>), sinon null. */
function emojiUrl(e: string): string | null {
  const m = /^<(a?):\w+:(\d+)>$/.exec(e.trim());
  return m ? `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? "gif" : "webp"}?size=48` : null;
}

function deplacer<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

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
  const toasts = useToasts();

  const [roles, setRoles] = useState<Role[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [ouvertes, setOuvertes] = useState<Record<string, boolean>>({});
  // Zone « coller une liste » par catégorie : présente = ouverte.
  const [collage, setCollage] = useState<Record<string, string | undefined>>({});
  const [creation, setCreation] = useState<Record<string, boolean>>({});

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
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  // Rôle → libellés des jeux qui l'utilisent (détection des doublons).
  const usages = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of cfg?.categories || [])
      for (const g of k.games)
        if (g.role_id) m.set(g.role_id, [...(m.get(g.role_id) || []), g.label || "?"]);
    return m;
  }, [cfg]);

  const set = (patch: Partial<JeuxCfg>) => mod.patch(patch);
  const setCats = (fn: (cats: Category[]) => Category[]) =>
    cfg && mod.setDraft({ ...cfg, categories: fn(cfg.categories) });
  const patchCatGames = (cid: string, fn: (games: Game[]) => Game[]) =>
    setCats((cats) => cats.map((k) => (k.id === cid ? { ...k, games: fn(k.games) } : k)));
  const patchCat = (cid: string, patch: Partial<Category>) =>
    setCats((cats) => cats.map((k) => (k.id === cid ? { ...k, ...patch } : k)));
  const patchGame = (cid: string, gid: string, patch: Partial<Game>) =>
    patchCatGames(cid, (games) => games.map((g) => (g.id === gid ? { ...g, ...patch } : g)));

  /** Rôle existant portant le nom du jeu (sans accents/casse/ponctuation). */
  const roleAuNom = (label: string) => {
    const n = normNom(label);
    return n ? roles.find((r) => normNom(r.name) === n) : undefined;
  };

  /** Crée le rôle Discord d'un jeu (ou retrouve celui qui porte déjà ce nom). */
  const creerRole = async (label: string): Promise<Role | null> => {
    try {
      const res = await fetch("/api/fripouille/action/jeux/create_role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label.trim() }),
      });
      if (!res.ok) return null;
      const role = (await res.json()).role as Role;
      setRoles((rs) => (rs.some((r) => r.id === role.id) ? rs : [role, ...rs]));
      return role;
    } catch {
      return null;
    }
  };

  const creerPour = async (cid: string, g: Game) => {
    setCreation((c) => ({ ...c, [g.id]: true }));
    const role = await creerRole(g.label);
    setCreation((c) => ({ ...c, [g.id]: false }));
    if (!role) return toasts.err("Rôle non créé", "La Fripouille a-t-elle « Gérer les rôles » ?");
    patchGame(cid, g.id, { role_id: role.id });
    toasts.ok(`Rôle @${role.name} prêt`, "Enregistre pour publier le bouton.");
  };

  const creerManquants = async (k: Category) => {
    const manquants = k.games.filter((g) => g.label.trim() && !g.role_id);
    const ids: Record<string, string> = {};
    for (const g of manquants) {
      setCreation((c) => ({ ...c, [g.id]: true }));
      const role = await creerRole(g.label);
      setCreation((c) => ({ ...c, [g.id]: false }));
      if (role) ids[g.id] = role.id;
    }
    patchCatGames(k.id, (games) => games.map((g) => (ids[g.id] ? { ...g, role_id: ids[g.id] } : g)));
    const n = Object.keys(ids).length;
    if (n < manquants.length)
      toasts.err(`${manquants.length - n} rôle(s) non créé(s)`, "Vérifie la permission « Gérer les rôles ».");
    else toasts.ok(`${n} rôle(s) créé(s)`, "Enregistre pour publier les boutons.");
  };

  const ajouterListe = (k: Category) => {
    const lignes = (collage[k.id] || "").split("\n").map(parseLigne).filter((l) => l.label);
    if (!lignes.length) return;
    const nouveaux = lignes.map((l) => ({
      ...newGame(),
      emoji: l.emoji,
      label: l.label,
      role_id: roleAuNom(l.label)?.id ?? null,
    }));
    patchCatGames(k.id, (games) =>
      [...games.filter((g) => g.label.trim() || g.role_id), ...nouveaux].slice(0, 25)
    );
    setCollage((c) => ({ ...c, [k.id]: undefined }));
  };

  const save = mod.save;
  const saving = mod.saving;
  const error = mod.error;

  if (mod.loading) return <Loading lignes={6} />;
  if (!cfg) return <Vide>{error || "La Fripouille est injoignable."}</Vide>;

  const validCats = cfg.categories.filter(
    (k) => k.label.trim() && k.games.some((g) => g.label.trim() && g.role_id)
  );
  const canSave = !cfg.enabled || (!!cfg.channel_id && validCats.length > 0);
  // Repliées par défaut dès qu'il y a plusieurs catégories (sauf les toutes neuves).
  const estOuverte = (k: Category) => ouvertes[k.id] ?? (cfg.categories.length <= 1 || !k.label);

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card span-all">
        <div className="cfg-card-head">
          <h2>🎮 Rôles-jeux</h2>
          <p>
            Range tes jeux en catégories (FPS, MMORPG, Simulation…). Chaque catégorie est postée
            comme un bloc de boutons : un clic sur un jeu donne son rôle (et l&apos;accès à ses
            salons), un second clic le retire.
          </p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Publier les blocs</span>
        </label>

        <div className="cfg-field">
          <label>Salon des blocs</label>
          <ChannelSelect
            channels={channels}
            value={cfg.channel_id}
            onChange={(v) => set({ channel_id: v })}
            placeholder="— Choisir un salon —"
          />
        </div>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Titre d&apos;intro (optionnel)</label>
            <input
              type="text"
              value={cfg.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Bienvenue sur le serveur !"
            />
          </div>
          <div className="cfg-field">
            <label>Description d&apos;intro (optionnel)</label>
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
            Tape le nom d&apos;un jeu : s&apos;il existe déjà un rôle du même nom, il est relié tout
            seul ; sinon « + Créer le rôle » le fabrique sur Discord (mentionnable, sans permission).
          </p>

          <div className="rec-list">
            {cfg.categories.map((k, ki) => {
              const ouverte = estOuverte(k);
              const sansRole = k.games.filter((g) => g.label.trim() && !g.role_id).length;
              return (
                <div className="reason-item jeux-cat" key={k.id}>
                  <div className="reason-head">
                    <button
                      type="button"
                      className="btn icon"
                      onClick={() => setOuvertes((o) => ({ ...o, [k.id]: !ouverte }))}
                      aria-expanded={ouverte}
                      title={ouverte ? "Replier" : "Déplier"}
                    >
                      {ouverte ? "▾" : "▸"}
                    </button>
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
                    <span className="jeux-compte">
                      {k.games.filter((g) => g.label.trim()).length}/25
                      {sansRole > 0 && <span className="jeux-alerte"> · {sansRole} sans rôle</span>}
                    </span>
                    <button className="btn icon" onClick={() => setCats((c) => deplacer(c, ki, -1))} disabled={ki === 0} title="Monter">↑</button>
                    <button className="btn icon" onClick={() => setCats((c) => deplacer(c, ki, 1))} disabled={ki === cfg.categories.length - 1} title="Descendre">↓</button>
                    <button
                      className="btn icon danger"
                      onClick={() => {
                        if (
                          k.games.some((g) => g.label.trim()) &&
                          !window.confirm(`Supprimer la catégorie « ${k.label || "sans nom"} » et ses jeux ?`)
                        )
                          return;
                        setCats((c) => c.filter((x) => x.id !== k.id));
                      }}
                      title="Supprimer la catégorie"
                    >
                      ✕
                    </button>
                  </div>

                  {ouverte && (
                    <>
                      <div className="cfg-field">
                        <label>Description (sous l&apos;en-tête)</label>
                        <input
                          type="text"
                          value={k.description}
                          onChange={(e) => patchCat(k.id, { description: e.target.value })}
                          placeholder="Choisis tes FPS favoris"
                        />
                      </div>

                      <div className="game-list">
                        {k.games.map((g, gi) => {
                          const role = g.role_id ? roleById.get(g.role_id) : undefined;
                          const memes = g.role_id ? usages.get(g.role_id) || [] : [];
                          return (
                            <div className={`game-row ${memes.length > 1 ? "doublon" : ""}`} key={g.id}>
                              {emojiUrl(g.emoji) && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img className="emoji-perso" src={emojiUrl(g.emoji)!} alt="" title={g.emoji} />
                              )}
                              <input
                                className="game-emoji"
                                type="text"
                                value={g.emoji}
                                onChange={(e) => patchGame(k.id, g.id, { emoji: e.target.value })}
                                placeholder="😀"
                                title="Emoji classique, ou emoji perso du serveur au format <:nom:id> (tape \:nom: dans Discord pour lire l'id)"
                                aria-label="Emoji du jeu"
                              />
                              <input
                                className="game-label"
                                type="text"
                                value={g.label}
                                onChange={(e) => patchGame(k.id, g.id, { label: e.target.value })}
                                onBlur={() => {
                                  if (g.role_id || !g.label.trim()) return;
                                  const r = roleAuNom(g.label);
                                  if (r) patchGame(k.id, g.id, { role_id: r.id });
                                }}
                                placeholder="Nom du jeu"
                                aria-label="Nom du jeu"
                              />
                              {!g.role_id && g.label.trim() && (
                                <button
                                  className="btn small primary"
                                  onClick={() => creerPour(k.id, g)}
                                  disabled={!!creation[g.id]}
                                  title={`Créer le rôle « ${g.label.trim()} » sur Discord`}
                                >
                                  {creation[g.id] ? "…" : "+ Créer le rôle"}
                                </button>
                              )}
                              <select
                                className="game-role"
                                value={g.role_id ?? ""}
                                onChange={(e) => patchGame(k.id, g.id, { role_id: e.target.value || null })}
                                aria-label="Rôle"
                                style={role ? { borderLeft: `4px solid ${hex(role.color)}` } : undefined}
                                title={memes.length > 1 ? `Rôle déjà utilisé par : ${memes.join(", ")}` : undefined}
                              >
                                <option value="">— ou choisir un rôle —</option>
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    @{r.name}
                                  </option>
                                ))}
                              </select>
                              <button className="btn icon" onClick={() => patchCatGames(k.id, (gs) => deplacer(gs, gi, -1))} disabled={gi === 0} title="Monter">↑</button>
                              <button className="btn icon" onClick={() => patchCatGames(k.id, (gs) => deplacer(gs, gi, 1))} disabled={gi === k.games.length - 1} title="Descendre">↓</button>
                              <button
                                className="btn icon danger"
                                onClick={() => patchCatGames(k.id, (games) => games.filter((x) => x.id !== g.id))}
                                title="Retirer le jeu"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="jeux-actions">
                        {k.games.length < 25 && (
                          <button className="btn" onClick={() => patchCatGames(k.id, (games) => [...games, newGame()])}>
                            + Ajouter un jeu
                          </button>
                        )}
                        <button
                          className="btn"
                          onClick={() =>
                            setCollage((c) => ({ ...c, [k.id]: c[k.id] === undefined ? "" : undefined }))
                          }
                        >
                          📋 Coller une liste
                        </button>
                        {sansRole > 0 && (
                          <button className="btn primary" onClick={() => creerManquants(k)}>
                            + Créer {sansRole > 1 ? `les ${sansRole} rôles manquants` : "le rôle manquant"}
                          </button>
                        )}
                      </div>
                      {collage[k.id] !== undefined && (
                        <div className="cfg-field" style={{ marginTop: 10 }}>
                          <textarea
                            rows={5}
                            autoFocus
                            value={collage[k.id]}
                            onChange={(e) => setCollage((c) => ({ ...c, [k.id]: e.target.value }))}
                            placeholder={"Un jeu par ligne, emoji en tête facultatif :\n🔫 Valorant\n🪖 Hell Let Loose\nRed Dead Redemption 2"}
                          />
                          <div className="jeux-actions">
                            <button className="btn primary" onClick={() => ajouterListe(k)}>
                              Ajouter ces jeux
                            </button>
                            <span className="cfg-hint">Les rôles du même nom sont reliés automatiquement.</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <button
            className="btn"
            onClick={() => {
              const k = newCategory();
              setCats((c) => [...c, k]);
              setOuvertes((o) => ({ ...o, [k.id]: true }));
            }}
          >
            + Ajouter une catégorie
          </button>
        </div>

        <JeuxApercu cfg={cfg} />

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
          La visibilité des salons se règle côté Discord (donner « Voir les salons » au rôle du
          jeu). Le rôle de La Fripouille doit rester au-dessus des rôles-jeux dans la hiérarchie.
          Un même rôle en double dans une catégorie n&apos;affiche qu&apos;un bouton.
        </p>
      </section>

      <TaverneAnnonces />
      <TaverneVeillee />
      <TaverneTesteurs />

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

/** Aperçu façon Discord : intro puis un bloc par catégorie (barre colorée + boutons). */
function JeuxApercu({ cfg }: { cfg: JeuxCfg }) {
  const cats = cfg.categories
    .map((k) => ({ ...k, games: k.games.filter((g) => g.label.trim() && g.role_id) }))
    .filter((k) => k.label.trim() && k.games.length);
  if (!cats.length) return null;
  return (
    <details className="jeux-apercu">
      <summary>👁 Aperçu dans Discord</summary>
      <div className="msg-preview">
        {(cfg.title.trim() || cfg.description.trim()) && (
          <div className="preview-embed" style={{ borderLeftColor: "#c9a44a" }}>
            <div className="preview-embed-main">
              {cfg.title.trim() && <div className="jeux-apercu-h1">{cfg.title}</div>}
              {cfg.description.trim() && (
                <div className="preview-embed-desc">
                  <em>{cfg.description}</em>
                </div>
              )}
              <div className="preview-embed-footer">
                👉 Clique sur un jeu pour rejoindre son salon · reclique pour le quitter
              </div>
            </div>
          </div>
        )}
        {cats.map((k, i) => (
          <div key={k.id}>
            <div className="preview-embed" style={{ borderLeftColor: CAT_PALETTE[i % CAT_PALETTE.length] }}>
              <div className="preview-embed-main">
                <div className="preview-embed-title">{`${k.emoji}  ${k.label}`.trim()}</div>
                {k.description.trim() && (
                  <div className="preview-embed-desc">
                    <em>{k.description}</em>
                  </div>
                )}
                <div className="preview-embed-footer">
                  {k.games.length} jeu{k.games.length > 1 ? "x" : ""}
                </div>
              </div>
            </div>
            <div className="jeux-apercu-btns">
              {k.games.map((g) => (
                <span key={g.id} className="dc-btn">
                  {emojiUrl(g.emoji) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="emoji-perso" src={emojiUrl(g.emoji)!} alt="" />
                  ) : g.emoji ? `${g.emoji} ` : ""}
                  {g.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
