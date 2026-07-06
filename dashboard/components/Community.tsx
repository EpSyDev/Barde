"use client";

import { useCallback, useEffect, useState } from "react";

type Role = { id: string; name: string; color: number };
type AutoroleCfg = { enabled: boolean; role_id: string | null };

export default function Community() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [cfg, setCfg] = useState<AutoroleCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rRes, cRes] = await Promise.all([
          fetch("/api/fripouille/roles", { cache: "no-store" }),
          fetch("/api/fripouille/config/autorole", { cache: "no-store" }),
        ]);
        if (!rRes.ok || !cRes.ok) throw new Error();
        const rData = await rRes.json();
        const cData = await cRes.json();
        setRoles(rData.roles || []);
        setCfg({
          enabled: !!cData.enabled,
          role_id: cData.role_id != null ? String(cData.role_id) : null,
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/fripouille/config/autorole", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: cfg.enabled, role_id: cfg.role_id }),
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
  if (!cfg || !roles) return <div className="empty-state">Chargement de la config…</div>;

  const hex = (c: number) =>
    c ? `#${c.toString(16).padStart(6, "0")}` : "var(--parchment-dim)";

  return (
    <div className="cfg-grid">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🚪 Rôle d'arrivée</h2>
          <p>Attribue automatiquement un rôle à chaque nouveau membre du serveur.</p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Activer l'attribution automatique</span>
        </label>

        <div className="cfg-field">
          <label htmlFor="role">Rôle à attribuer</label>
          <div className="select-wrap">
            {cfg.role_id && (
              <span
                className="role-swatch"
                style={{
                  background: hex(
                    roles.find((r) => r.id === cfg.role_id)?.color ?? 0
                  ),
                }}
              />
            )}
            <select
              id="role"
              value={cfg.role_id ?? ""}
              onChange={(e) => setCfg({ ...cfg, role_id: e.target.value || null })}
              disabled={!cfg.enabled}
            >
              <option value="">— Choisir un rôle —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {roles.length === 0 && (
            <p className="cfg-hint">
              Aucun rôle attribuable trouvé (le bot voit-il bien le serveur ?).
            </p>
          )}
        </div>

        <div className="cfg-actions">
          <button
            className="btn primary"
            onClick={save}
            disabled={saving || (cfg.enabled && !cfg.role_id)}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          {saved && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>
      </section>
    </div>
  );
}
