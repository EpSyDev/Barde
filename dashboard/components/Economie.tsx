"use client";

import { useEffect, useMemo, useState } from "react";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";

type Devise = {
  nom: string;
  nom_singulier: string;
  symbole: string;
  symbole_avant: boolean;
};

type GainKey =
  | "message"
  | "daily"
  | "reaction"
  | "vocal"
  | "bienvenue"
  | "bapteme"
  | "role_jeu"
  | "boost"
  | "ticket_resolu"
  | "anciennete"
  | "seuil_reactions";

// Chaque source a `enabled` + `montant`, plus au maximum UN champ secondaire selon son
// type (cooldown anti-spam, palier en minutes, seuil de réactions, ou liste de paliers
// en jours) — c'est ce qui permet de les rendre en boucle plutôt qu'un bloc par source.
type GainRule = {
  enabled: boolean;
  montant: number;
  cooldown?: number;
  minutes?: number;
  seuil?: number;
  paliers_jours?: number[];
};
type Gains = Record<GainKey, GainRule>;

type GainExtra = "cooldown" | "minutes" | "seuil" | "paliers";
type GainMeta = { key: GainKey; label: string; hint: string; extra?: GainExtra };

const GAIN_META: GainMeta[] = [
  { key: "message", label: "Message envoyé", hint: "Anti-spam : délai minimum entre deux gains d'un même membre.", extra: "cooldown" },
  { key: "daily", label: "Récompense quotidienne (/daily)", hint: "86400 = 24 h.", extra: "cooldown" },
  { key: "reaction", label: "Réagir à un message", hint: "Anti-spam : délai minimum entre deux gains d'un même membre.", extra: "cooldown" },
  { key: "vocal", label: "Temps passé en vocal", hint: "Crédité toutes les N minutes connecté (salon AFK exclu).", extra: "minutes" },
  { key: "bienvenue", label: "Arrivée sur le serveur", hint: "Une seule fois par compte, même après un départ/retour." },
  { key: "bapteme", label: "Baptême complété", hint: "Une seule fois par compte (un re-baptême ne recrédite pas)." },
  { key: "role_jeu", label: "Premier rôle-jeu choisi", hint: "Une seule fois par compte." },
  { key: "boost", label: "Boost du serveur", hint: "À chaque nouveau boost." },
  { key: "ticket_resolu", label: "Ticket résolu (staff)", hint: "Crédité au membre qui a pris en charge le ticket." },
  { key: "seuil_reactions", label: "Message très réagi (auteur)", hint: "Récompense l'auteur, une fois par message.", extra: "seuil" },
  { key: "anciennete", label: "Palier d'ancienneté", hint: "Paliers en jours depuis l'arrivée, séparés par des virgules (ex. 30, 90, 365).", extra: "paliers" },
];

const DEFAULT_GAIN_RULE: GainRule = { enabled: false, montant: 0, cooldown: 60, minutes: 30, seuil: 10, paliers_jours: [30, 90, 365] };

/** Ne garde que le champ secondaire pertinent pour ce type de source, sanitizé. */
function sanitizeGainRule(meta: GainMeta, rule: GainRule): GainRule {
  const out: GainRule = { enabled: rule.enabled, montant: Math.max(0, Number(rule.montant) || 0) };
  if (meta.extra === "cooldown") out.cooldown = Math.max(0, Number(rule.cooldown) || 0);
  if (meta.extra === "minutes") out.minutes = Math.max(1, Number(rule.minutes) || 1);
  if (meta.extra === "seuil") out.seuil = Math.max(1, Number(rule.seuil) || 1);
  if (meta.extra === "paliers") {
    out.paliers_jours = (rule.paliers_jours || []).map((j) => Math.max(0, Number(j) || 0)).filter((j) => j > 0);
  }
  return out;
}

type ItemType = "objet" | "role";
type Item = {
  id: string;
  nom: string;
  description: string;
  prix: number;
  type: ItemType;
  role_id: string | null;
  stock: number | null; // null = illimité
  enabled: boolean;
  taverne: boolean; // objet servi par Brom dans la Taverne 3D (jeu MYRHAVEN)
};
type Role = { id: string; name: string; color: number };
type Category = { id: string; name: string };

const DEFAULT_DEVISE: Devise = {
  nom: "Écus",
  nom_singulier: "Écu",
  symbole: "🪙",
  symbole_avant: false,
};

const newItem = (): Item => ({
  id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8),
  nom: "",
  description: "",
  prix: 100,
  type: "role",
  role_id: null,
  stock: null,
  enabled: true,
  taverne: false,
});

function formatAmount(devise: Devise, amount: number): string {
  const sym = (devise.symbole || "").trim();
  const n = new Intl.NumberFormat("fr-FR").format(Math.round(amount || 0));
  if (sym) return devise.symbole_avant ? `${sym} ${n}` : `${n} ${sym}`;
  const label =
    Math.abs(amount) === 1 ? devise.nom_singulier || devise.nom : devise.nom;
  return `${n} ${label}`.trim();
}

type EcoCfg = {
  category_id: string | null;
  devise: Devise;
  gains: Gains;
  boutique: Item[];
};

const LABELS: Record<string, string> = {
  category_id: "Catégorie « espace RP »",
  devise: "Devise",
  gains: "Sources de gains",
  boutique: "Boutique",
};

const normalize = (d: Record<string, unknown>): EcoCfg => {
  const recus = (d.gains || {}) as Record<string, Partial<GainRule>>;
  return {
    category_id: d.category_id != null ? String(d.category_id) : null,
    devise: { ...DEFAULT_DEVISE, ...((d.devise as Partial<Devise>) || {}) },
    gains: Object.fromEntries(
      GAIN_META.map((m) => [m.key, { ...DEFAULT_GAIN_RULE, ...(recus[m.key] || {}) }])
    ) as Gains,
    boutique: (((d.boutique as Partial<Item>[]) || []).map((it) => ({
      ...newItem(),
      ...it,
      role_id: it.role_id != null ? String(it.role_id) : null,
      stock: it.stock == null || Number(it.stock) < 0 ? null : Number(it.stock),
    }))),
  };
};

/** Nettoyage au moment de l'envoi : la frappe en cours n'est jamais corrigée sous
 *  les doigts, mais le bot ne reçoit ni article sans nom ni champ parasite. */
const serialize = (cfg: EcoCfg) => ({
  category_id: cfg.category_id,
  devise: {
    nom: cfg.devise.nom.trim() || "points",
    nom_singulier: cfg.devise.nom_singulier.trim() || cfg.devise.nom.trim() || "point",
    symbole: cfg.devise.symbole.trim(),
    symbole_avant: cfg.devise.symbole_avant,
  },
  gains: Object.fromEntries(GAIN_META.map((m) => [m.key, sanitizeGainRule(m, cfg.gains[m.key])])),
  boutique: cfg.boutique
    .filter((it) => it.nom.trim())
    .map((it) => ({
      id: it.id,
      nom: it.nom.trim(),
      description: it.description.trim(),
      prix: Math.max(0, Number(it.prix) || 0),
      type: it.type,
      role_id: it.type === "role" ? it.role_id : null,
      stock: it.stock == null ? null : Math.max(0, Number(it.stock) || 0),
      enabled: it.enabled,
      taverne: it.type === "objet" && it.taverne,
    })),
});

export default function Economie() {
  const mod = useModuleConfig<EcoCfg>("economie", normalize, serialize);
  useUnsavedGuard(mod.dirty);

  const [tab, setTab] = useState<"reglages" | "boutique">("reglages");
  const [roles, setRoles] = useState<Role[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/fripouille/roles", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { roles: [] })),
      fetch("/api/fripouille/categories", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { categories: [] })),
    ])
      .then(([r, c]) => {
        setRoles(r.roles || []);
        setCategories(c.categories || []);
      })
      .catch(() => undefined);
  }, []);

  // La devise, les gains et la boutique sont trois vues d'une même config : un seul
  // brouillon, un seul enregistrement — les boutons par carte le déclenchent aussi.
  const draft = mod.draft;
  const devise = draft?.devise ?? null;
  const gains = draft?.gains ?? null;
  const boutique = draft?.boutique ?? null;
  const categoryId = draft?.category_id ?? null;

  const setCategoryId = (v: string | null) => mod.patch({ category_id: v });
  const setDev = (patch: Partial<Devise>) =>
    draft && mod.patch({ devise: { ...draft.devise, ...patch } });
  const setGain = (key: keyof Gains, patch: Partial<GainRule>) =>
    draft && mod.patch({ gains: { ...draft.gains, [key]: { ...draft.gains[key], ...patch } } });
  const setBoutique = (items: Item[]) => mod.patch({ boutique: items });
  const patchItem = (id: string, patch: Partial<Item>) =>
    draft && mod.patch({
      boutique: draft.boutique.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });

  const saveCfg = mod.save;
  const saveShop = mod.save;
  const savingCfg = mod.saving;
  const savingShop = mod.saving;

  const preview = useMemo(() => (devise ? formatAmount(devise, 1500) : ""), [devise]);

  if (mod.loading) return <Loading lignes={6} />;
  if (!devise || !gains || !boutique) {
    return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;
  }

  return (
    <div>
      <div className="tabs">
        <button
          className={`tab ${tab === "reglages" ? "active" : ""}`}
          onClick={() => setTab("reglages")}
        >
          🪙 Devise & gains
        </button>
        <button
          className={`tab ${tab === "boutique" ? "active" : ""}`}
          onClick={() => setTab("boutique")}
        >
          🛒 Boutique
        </button>
      </div>

      {tab === "reglages" && (
        <div className="cfg-grid">
          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>📍 Portée</h2>
              <p>
                Hors de cette catégorie, l'économie est entièrement inactive (gains ET
                commandes /solde, /donner, /daily, /boutique...). Seuls les membres ayant un
                rôle de race (baptisés) peuvent gagner ou dépenser, sans exception.
              </p>
            </div>
            <div className="cfg-field">
              <label>Catégorie « espace RP »</label>
              <select
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(e.target.value || null)}
              >
                <option value="">— Choisir une catégorie —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!categoryId && (
                <p className="cfg-hint">
                  Aucune catégorie choisie = économie désactivée partout sur le serveur.
                </p>
              )}
            </div>
            <div className="cfg-actions">
              <button className="btn primary" onClick={saveCfg} disabled={savingCfg}>
                {savingCfg ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </section>

          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🪙 Devise</h2>
              <p>Le nom et le symbole de la monnaie, affichés partout dans le bot.</p>
            </div>

            <div className="field-2col">
              <div className="cfg-field">
                <label>Nom (pluriel)</label>
                <input
                  type="text"
                  value={devise.nom}
                  onChange={(e) => setDev({ nom: e.target.value })}
                  placeholder="Écus"
                />
              </div>
              <div className="cfg-field">
                <label>Nom (singulier)</label>
                <input
                  type="text"
                  value={devise.nom_singulier}
                  onChange={(e) => setDev({ nom_singulier: e.target.value })}
                  placeholder="Écu"
                />
              </div>
            </div>

            <div className="field-2col">
              <div className="cfg-field">
                <label>Symbole (emoji ou caractère)</label>
                <input
                  type="text"
                  value={devise.symbole}
                  onChange={(e) => setDev({ symbole: e.target.value })}
                  placeholder="🪙"
                />
                <p className="cfg-hint">
                  Prioritaire sur le nom. Laisse vide pour afficher le nom à la place.
                </p>
              </div>
              <div className="cfg-field">
                <label>Position du symbole</label>
                <label className="cfg-toggle compact" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={devise.symbole_avant}
                    onChange={(e) => setDev({ symbole_avant: e.target.checked })}
                  />
                  <span className="switch" />
                  <span>Symbole avant le montant</span>
                </label>
              </div>
            </div>

            <p className="cfg-hint">
              Aperçu : <strong>{preview}</strong>
            </p>

            <div className="cfg-actions">
              <button className="btn primary" onClick={saveCfg} disabled={savingCfg}>
                {savingCfg ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </section>

          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🎁 Sources de gains</h2>
              <p>Comment les membres gagnent de la monnaie. Les changements s'appliquent aussitôt.</p>
            </div>

            {GAIN_META.map((meta) => {
              const rule = gains[meta.key];
              return (
                <div className="rec-item" key={meta.key}>
                  <label className="cfg-toggle compact">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => setGain(meta.key, { enabled: e.target.checked })}
                    />
                    <span className="switch" />
                    <span>{meta.label}</span>
                  </label>
                  <div className="field-2col">
                    <div className="cfg-field">
                      <label>Montant</label>
                      <input
                        type="number"
                        min={0}
                        value={rule.montant}
                        onChange={(e) => setGain(meta.key, { montant: Number(e.target.value) })}
                      />
                    </div>
                    {meta.extra === "cooldown" && (
                      <div className="cfg-field">
                        <label>Anti-spam (secondes)</label>
                        <input
                          type="number"
                          min={0}
                          value={rule.cooldown ?? 0}
                          onChange={(e) => setGain(meta.key, { cooldown: Number(e.target.value) })}
                        />
                      </div>
                    )}
                    {meta.extra === "minutes" && (
                      <div className="cfg-field">
                        <label>Toutes les (minutes)</label>
                        <input
                          type="number"
                          min={1}
                          value={rule.minutes ?? 30}
                          onChange={(e) => setGain(meta.key, { minutes: Number(e.target.value) })}
                        />
                      </div>
                    )}
                    {meta.extra === "seuil" && (
                      <div className="cfg-field">
                        <label>Seuil de réactions</label>
                        <input
                          type="number"
                          min={1}
                          value={rule.seuil ?? 10}
                          onChange={(e) => setGain(meta.key, { seuil: Number(e.target.value) })}
                        />
                      </div>
                    )}
                    {meta.extra === "paliers" && (
                      <div className="cfg-field">
                        <label>Paliers (jours)</label>
                        <input
                          type="text"
                          value={(rule.paliers_jours || []).join(", ")}
                          onChange={(e) =>
                            setGain(meta.key, {
                              paliers_jours: e.target.value
                                .split(",")
                                .map((v) => Number(v.trim()))
                                .filter((v) => Number.isFinite(v) && v > 0),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                  {meta.hint && <p className="cfg-hint">{meta.hint}</p>}
                </div>
              );
            })}

            <div className="cfg-actions">
              <button className="btn primary" onClick={saveCfg} disabled={savingCfg}>
                {savingCfg ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </section>
        </div>
      )}

      {tab === "boutique" && (
        <div className="cfg-grid wide">
          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🛒 Catalogue de la boutique</h2>
              <p>Articles achetables avec la monnaie. Un rôle acheté est attribué automatiquement.</p>
            </div>

            {boutique.length === 0 && (
              <p className="cfg-hint">Aucun article pour l'instant.</p>
            )}

            {boutique.map((it) => (
              <div className="rec-item" key={it.id}>
                <div className="rec-head">
                  <label className="cfg-toggle compact">
                    <input
                      type="checkbox"
                      checked={it.enabled}
                      onChange={(e) => patchItem(it.id, { enabled: e.target.checked })}
                    />
                    <span className="switch" />
                    <span>En vente</span>
                  </label>
                  <span className="cfg-hint" style={{ marginLeft: "auto", marginRight: 8 }}>
                    {formatAmount(devise, Number(it.prix) || 0)}
                  </span>
                  <button
                    className="btn icon danger"
                    onClick={() => setBoutique(boutique.filter((x) => x.id !== it.id))}
                    title="Retirer"
                  >
                    ✕
                  </button>
                </div>

                <div className="field-2col">
                  <div className="cfg-field">
                    <label>Nom de l'article</label>
                    <input
                      type="text"
                      value={it.nom}
                      onChange={(e) => patchItem(it.id, { nom: e.target.value })}
                      placeholder="Ex. Rôle VIP"
                    />
                  </div>
                  <div className="cfg-field">
                    <label>Prix</label>
                    <input
                      type="number"
                      min={0}
                      value={it.prix}
                      onChange={(e) => patchItem(it.id, { prix: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="cfg-field">
                  <label>Description (optionnel)</label>
                  <input
                    type="text"
                    value={it.description}
                    onChange={(e) => patchItem(it.id, { description: e.target.value })}
                    placeholder="Courte description affichée en boutique"
                  />
                </div>

                <div className="field-2col">
                  <div className="cfg-field">
                    <label>Type</label>
                    <select
                      value={it.type}
                      onChange={(e) =>
                        patchItem(it.id, { type: e.target.value as ItemType })
                      }
                    >
                      <option value="role">🎭 Rôle Discord</option>
                      <option value="objet">📦 Objet (cosmétique / custom)</option>
                    </select>
                    {it.type === "objet" && (
                      <label className="cfg-toggle compact" style={{ marginTop: 8 }}>
                        <input
                          type="checkbox"
                          checked={it.taverne}
                          onChange={(e) => patchItem(it.id, { taverne: e.target.checked })}
                        />
                        <span className="switch" />
                        <span>Servi par Brom à la Taverne (jeu 3D)</span>
                      </label>
                    )}
                  </div>
                  <div className="cfg-field">
                    <label>Stock</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label className="cfg-toggle compact">
                        <input
                          type="checkbox"
                          checked={it.stock == null}
                          onChange={(e) =>
                            patchItem(it.id, { stock: e.target.checked ? null : 0 })
                          }
                        />
                        <span className="switch" />
                        <span>Illimité</span>
                      </label>
                      {it.stock != null && (
                        <input
                          type="number"
                          min={0}
                          value={it.stock}
                          onChange={(e) =>
                            patchItem(it.id, { stock: Math.max(0, Number(e.target.value) || 0) })
                          }
                          style={{ maxWidth: 100 }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {it.type === "role" && (
                  <div className="cfg-field">
                    <label>Rôle attribué à l'achat</label>
                    <select
                      value={it.role_id ?? ""}
                      onChange={(e) => patchItem(it.id, { role_id: e.target.value || null })}
                    >
                      <option value="">— Choisir un rôle —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    {!it.role_id && (
                      <p className="cfg-hint">Sans rôle choisi, l'achat ne donnera aucun rôle.</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="rec-foot">
              <button className="btn" onClick={() => setBoutique([...boutique, newItem()])}>
                + Ajouter un article
              </button>
              <div className="cfg-actions">
                <button className="btn primary" onClick={saveShop} disabled={savingShop}>
                  {savingShop ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>

            <p className="cfg-hint">
              La Fripouille doit avoir « Gérer les rôles » et son rôle placé au-dessus des rôles
              vendus dans la hiérarchie, sinon l'attribution échouera.
            </p>
          </section>
        </div>
      )}

      <DirtyBar
        dirty={mod.dirty}
        dirtyKeys={mod.dirtyKeys}
        saving={mod.saving}
        onSave={mod.save}
        onReset={mod.reset}
        labels={LABELS}
      />
    </div>
  );
}
