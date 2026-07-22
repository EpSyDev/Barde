"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Devise = {
  nom: string;
  nom_singulier: string;
  symbole: string;
  symbole_avant: boolean;
};
type GainRule = { enabled: boolean; montant: number; cooldown: number };
type Gains = { message: GainRule; daily: GainRule };
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
};
type Role = { id: string; name: string; color: number };

const DEFAULT_DEVISE: Devise = {
  nom: "Écus",
  nom_singulier: "Écu",
  symbole: "🪙",
  symbole_avant: false,
};
const DEFAULT_GAINS: Gains = {
  message: { enabled: false, montant: 1, cooldown: 60 },
  daily: { enabled: true, montant: 100, cooldown: 86400 },
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
});

function formatAmount(devise: Devise, amount: number): string {
  const sym = (devise.symbole || "").trim();
  const n = new Intl.NumberFormat("fr-FR").format(Math.round(amount || 0));
  if (sym) return devise.symbole_avant ? `${sym} ${n}` : `${n} ${sym}`;
  const label =
    Math.abs(amount) === 1 ? devise.nom_singulier || devise.nom : devise.nom;
  return `${n} ${label}`.trim();
}

export default function Economie() {
  const [tab, setTab] = useState<"reglages" | "boutique">("reglages");
  const [devise, setDevise] = useState<Devise | null>(null);
  const [gains, setGains] = useState<Gains | null>(null);
  const [boutique, setBoutique] = useState<Item[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);

  const [savingCfg, setSavingCfg] = useState(false);
  const [savedCfg, setSavedCfg] = useState(false);
  const [savingShop, setSavingShop] = useState(false);
  const [savedShop, setSavedShop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, rRes] = await Promise.all([
          fetch("/api/fripouille/config/economie", { cache: "no-store" }),
          fetch("/api/fripouille/roles", { cache: "no-store" }),
        ]);
        if (!cRes.ok) throw new Error();
        const d = await cRes.json();
        const rData = rRes.ok ? await rRes.json() : { roles: [] };
        setDevise({ ...DEFAULT_DEVISE, ...(d.devise || {}) });
        setGains({
          message: { ...DEFAULT_GAINS.message, ...((d.gains || {}).message || {}) },
          daily: { ...DEFAULT_GAINS.daily, ...((d.gains || {}).daily || {}) },
        });
        setBoutique(
          (d.boutique || []).map((it: Partial<Item>) => ({
            ...newItem(),
            ...it,
            role_id: it.role_id != null ? String(it.role_id) : null,
            stock: it.stock == null || Number(it.stock) < 0 ? null : Number(it.stock),
          }))
        );
        setRoles(rData.roles || []);
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const setDev = (patch: Partial<Devise>) =>
    setDevise((d) => (d ? { ...d, ...patch } : d));
  const setGain = (key: keyof Gains, patch: Partial<GainRule>) =>
    setGains((g) => (g ? { ...g, [key]: { ...g[key], ...patch } } : g));
  const patchItem = (id: string, patch: Partial<Item>) =>
    setBoutique((items) =>
      items ? items.map((it) => (it.id === id ? { ...it, ...patch } : it)) : items
    );

  const saveCfg = useCallback(async () => {
    if (!devise || !gains) return;
    setSavingCfg(true);
    setSavedCfg(false);
    setError(null);
    try {
      const res = await fetch("/api/fripouille/config/economie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devise: {
            nom: devise.nom.trim() || "points",
            nom_singulier: devise.nom_singulier.trim() || devise.nom.trim() || "point",
            symbole: devise.symbole.trim(),
            symbole_avant: devise.symbole_avant,
          },
          gains: {
            message: {
              enabled: gains.message.enabled,
              montant: Math.max(0, Number(gains.message.montant) || 0),
              cooldown: Math.max(0, Number(gains.message.cooldown) || 0),
            },
            daily: {
              enabled: gains.daily.enabled,
              montant: Math.max(0, Number(gains.daily.montant) || 0),
              cooldown: Math.max(0, Number(gains.daily.cooldown) || 0),
            },
          },
        }),
      });
      if (!res.ok) throw new Error();
      setSavedCfg(true);
      setTimeout(() => setSavedCfg(false), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setSavingCfg(false);
    }
  }, [devise, gains]);

  const saveShop = useCallback(async () => {
    if (!boutique) return;
    setSavingShop(true);
    setSavedShop(false);
    setError(null);
    try {
      const payload = boutique
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
        }));
      const res = await fetch("/api/fripouille/config/economie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boutique: payload }),
      });
      if (!res.ok) throw new Error();
      setSavedShop(true);
      setTimeout(() => setSavedShop(false), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setSavingShop(false);
    }
  }, [boutique]);

  const preview = useMemo(
    () => (devise ? formatAmount(devise, 1500) : ""),
    [devise]
  );

  if (error && !devise) return <div className="empty-state">{error}</div>;
  if (!devise || !gains || !boutique)
    return <div className="empty-state">Chargement de l'économie…</div>;

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
              {savedCfg && <span className="cfg-ok">✓ Enregistré</span>}
              {error && <span className="cfg-err">{error}</span>}
            </div>
          </section>

          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🎁 Sources de gains</h2>
              <p>Comment les membres gagnent de la monnaie. Les changements s'appliquent aussitôt.</p>
            </div>

            <div className="rec-item">
              <label className="cfg-toggle compact">
                <input
                  type="checkbox"
                  checked={gains.message.enabled}
                  onChange={(e) => setGain("message", { enabled: e.target.checked })}
                />
                <span className="switch" />
                <span>Gain sur message</span>
              </label>
              <div className="field-2col">
                <div className="cfg-field">
                  <label>Montant par message</label>
                  <input
                    type="number"
                    min={0}
                    value={gains.message.montant}
                    onChange={(e) => setGain("message", { montant: Number(e.target.value) })}
                  />
                </div>
                <div className="cfg-field">
                  <label>Anti-spam (secondes)</label>
                  <input
                    type="number"
                    min={0}
                    value={gains.message.cooldown}
                    onChange={(e) => setGain("message", { cooldown: Number(e.target.value) })}
                  />
                  <p className="cfg-hint">Délai minimum entre deux gains d'un même membre.</p>
                </div>
              </div>
            </div>

            <div className="rec-item">
              <label className="cfg-toggle compact">
                <input
                  type="checkbox"
                  checked={gains.daily.enabled}
                  onChange={(e) => setGain("daily", { enabled: e.target.checked })}
                />
                <span className="switch" />
                <span>Récompense quotidienne (/daily)</span>
              </label>
              <div className="field-2col">
                <div className="cfg-field">
                  <label>Montant</label>
                  <input
                    type="number"
                    min={0}
                    value={gains.daily.montant}
                    onChange={(e) => setGain("daily", { montant: Number(e.target.value) })}
                  />
                </div>
                <div className="cfg-field">
                  <label>Délai (secondes)</label>
                  <input
                    type="number"
                    min={0}
                    value={gains.daily.cooldown}
                    onChange={(e) => setGain("daily", { cooldown: Number(e.target.value) })}
                  />
                  <p className="cfg-hint">86400 = 24 h.</p>
                </div>
              </div>
            </div>

            <div className="cfg-actions">
              <button className="btn primary" onClick={saveCfg} disabled={savingCfg}>
                {savingCfg ? "Enregistrement…" : "Enregistrer"}
              </button>
              {savedCfg && <span className="cfg-ok">✓ Enregistré</span>}
              {error && <span className="cfg-err">{error}</span>}
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
                {savedShop && <span className="cfg-ok">✓ Enregistré</span>}
                {error && <span className="cfg-err">{error}</span>}
              </div>
            </div>

            <p className="cfg-hint">
              La Fripouille doit avoir « Gérer les rôles » et son rôle placé au-dessus des rôles
              vendus dans la hiérarchie, sinon l'attribution échouera.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
