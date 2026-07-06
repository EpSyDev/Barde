"use client";

import { useCallback, useEffect, useState } from "react";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };
type AutoroleCfg = { enabled: boolean; role_id: string | null };
type WelcomeCfg = {
  enabled: boolean;
  channel_id: string | null;
  message: string;
  image_url: string;
};

export default function Community() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [auto, setAuto] = useState<AutoroleCfg | null>(null);
  const [welcome, setWelcome] = useState<WelcomeCfg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [okCard, setOkCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rRes, chRes, aRes, wRes] = await Promise.all([
          fetch("/api/fripouille/roles", { cache: "no-store" }),
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/config/autorole", { cache: "no-store" }),
          fetch("/api/fripouille/config/welcome", { cache: "no-store" }),
        ]);
        if (!rRes.ok || !chRes.ok || !aRes.ok || !wRes.ok) throw new Error();
        const rData = await rRes.json();
        const chData = await chRes.json();
        const aData = await aRes.json();
        const wData = await wRes.json();
        setRoles(rData.roles || []);
        setChannels(chData.channels || []);
        setAuto({
          enabled: !!aData.enabled,
          role_id: aData.role_id != null ? String(aData.role_id) : null,
        });
        setWelcome({
          enabled: !!wData.enabled,
          channel_id: wData.channel_id != null ? String(wData.channel_id) : null,
          message: wData.message || "",
          image_url: wData.image_url || "",
        });
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const saveModule = useCallback(async (module: string, body: object) => {
    setBusy(module);
    setOkCard(null);
    setError(null);
    try {
      const res = await fetch(`/api/fripouille/config/${module}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setOkCard(module);
      setTimeout(() => setOkCard((c) => (c === module ? null : c)), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setBusy(null);
    }
  }, []);

  if (error && !auto) return <div className="empty-state">{error}</div>;
  if (!auto || !welcome || !roles || !channels)
    return <div className="empty-state">Chargement de la config…</div>;

  const hex = (c: number) =>
    c ? `#${c.toString(16).padStart(6, "0")}` : "var(--parchment-dim)";

  return (
    <div className="cfg-grid">
      {/* --- Rôle d'arrivée --- */}
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🚪 Rôle d'arrivée</h2>
          <p>Attribue automatiquement un rôle à chaque nouveau membre du serveur.</p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={auto.enabled}
            onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Activer l'attribution automatique</span>
        </label>

        <div className="cfg-field">
          <label htmlFor="role">Rôle à attribuer</label>
          <div className="select-wrap">
            {auto.role_id && (
              <span
                className="role-swatch"
                style={{ background: hex(roles.find((r) => r.id === auto.role_id)?.color ?? 0) }}
              />
            )}
            <select
              id="role"
              value={auto.role_id ?? ""}
              onChange={(e) => setAuto({ ...auto, role_id: e.target.value || null })}
            >
              <option value="">— Choisir un rôle —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="cfg-actions">
          <button
            className="btn primary"
            onClick={() => saveModule("autorole", { enabled: auto.enabled, role_id: auto.role_id })}
            disabled={busy === "autorole" || (auto.enabled && !auto.role_id)}
          >
            {busy === "autorole" ? "Enregistrement…" : "Enregistrer"}
          </button>
          {okCard === "autorole" && <span className="cfg-ok">✓ Enregistré</span>}
        </div>
      </section>

      {/* --- Message d'accueil --- */}
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>👋 Message d'accueil</h2>
          <p>Annonce l'arrivée d'un nouveau membre pour que la communauté l'accueille.</p>
        </div>

        <label className="cfg-toggle">
          <input
            type="checkbox"
            checked={welcome.enabled}
            onChange={(e) => setWelcome({ ...welcome, enabled: e.target.checked })}
          />
          <span className="switch" />
          <span>Activer l'annonce d'arrivée</span>
        </label>

        <div className="cfg-field">
          <label htmlFor="wchan">Salon de l'annonce</label>
          <select
            id="wchan"
            value={welcome.channel_id ?? ""}
            onChange={(e) => setWelcome({ ...welcome, channel_id: e.target.value || null })}
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
          <label htmlFor="wmsg">Message</label>
          <textarea
            id="wmsg"
            rows={3}
            value={welcome.message}
            onChange={(e) => setWelcome({ ...welcome, message: e.target.value })}
            placeholder="Bienvenue à {mention} à la Taverne ! 🍻"
          />
          <p className="cfg-hint">
            Variables : <code>{"{mention}"}</code> ping le membre, <code>{"{name}"}</code>{" "}
            son pseudo, <code>{"{server}"}</code> le serveur, <code>{"{count}"}</code> le
            nombre de membres.
          </p>
        </div>

        <div className="cfg-field">
          <label htmlFor="wimg">Image de l'embed (URL)</label>
          <input
            id="wimg"
            type="text"
            value={welcome.image_url}
            onChange={(e) => setWelcome({ ...welcome, image_url: e.target.value })}
            placeholder="https://…"
          />
          <p className="cfg-hint">
            Par défaut le fond de la Taverne. Laisse vide pour n'envoyer que le texte.
          </p>
          {welcome.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={welcome.image_url}
              alt=""
              style={{
                marginTop: 8,
                maxWidth: "100%",
                borderRadius: 8,
                border: "1px solid var(--panel-edge)",
              }}
            />
          )}
        </div>

        <div className="cfg-actions">
          <button
            className="btn primary"
            onClick={() =>
              saveModule("welcome", {
                enabled: welcome.enabled,
                channel_id: welcome.channel_id,
                message: welcome.message,
                image_url: welcome.image_url,
              })
            }
            disabled={busy === "welcome" || (welcome.enabled && !welcome.channel_id)}
          >
            {busy === "welcome" ? "Enregistrement…" : "Enregistrer"}
          </button>
          {okCard === "welcome" && <span className="cfg-ok">✓ Enregistré</span>}
          {error && <span className="cfg-err">{error}</span>}
        </div>
      </section>
    </div>
  );
}
