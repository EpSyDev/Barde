"use client";

import { useCallback, useEffect, useState } from "react";

type Channel = { id: string; name: string; category: string | null };
type Embed = {
  title: string;
  description: string;
  color: string;
  image_url: string;
  thumbnail_url: string;
  footer: string;
};
type Unit = "minutes" | "hours" | "days" | "weeks";
type Recurring = {
  id: string;
  enabled: boolean;
  channel_id: string | null;
  content: string;
  embed: Embed;
  interval_value: number;
  interval_unit: Unit;
};

const emptyEmbed = (): Embed => ({
  title: "",
  description: "",
  color: "#c9a44a",
  image_url: "",
  thumbnail_url: "",
  footer: "",
});

const newRecurring = (): Recurring => ({
  id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8),
  enabled: true,
  channel_id: null,
  content: "",
  embed: emptyEmbed(),
  interval_value: 1,
  interval_unit: "days",
});

const UNITS: { value: Unit; label: string }[] = [
  { value: "minutes", label: "minute(s)" },
  { value: "hours", label: "heure(s)" },
  { value: "days", label: "jour(s)" },
  { value: "weeks", label: "semaine(s)" },
];

function ChannelSelect({
  channels,
  value,
  onChange,
}: {
  channels: Channel[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Salon —</option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.name}
          {c.category ? ` (${c.category})` : ""}
        </option>
      ))}
    </select>
  );
}

function MessageEditor({
  content,
  embed,
  onContent,
  onEmbed,
}: {
  content: string;
  embed: Embed;
  onContent: (v: string) => void;
  onEmbed: (patch: Partial<Embed>) => void;
}) {
  return (
    <div className="msg-editor">
      <div className="cfg-field">
        <label>Texte (hors embed)</label>
        <textarea
          rows={2}
          value={content}
          onChange={(e) => onContent(e.target.value)}
          placeholder="Message simple, ou laisse vide pour n'envoyer que l'embed…"
        />
      </div>

      <div className="embed-fields">
        <div className="embed-fields-head">
          <span>Embed</span>
          <label className="color-pick">
            Couleur
            <input
              type="color"
              value={embed.color || "#c9a44a"}
              onChange={(e) => onEmbed({ color: e.target.value })}
            />
          </label>
        </div>
        <div className="cfg-field">
          <label>Titre</label>
          <input
            type="text"
            value={embed.title}
            onChange={(e) => onEmbed({ title: e.target.value })}
            placeholder="Titre de l'embed"
          />
        </div>
        <div className="cfg-field">
          <label>Description</label>
          <textarea
            rows={3}
            value={embed.description}
            onChange={(e) => onEmbed({ description: e.target.value })}
            placeholder="Corps de l'embed (les retours à la ligne sont conservés)"
          />
        </div>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Image (URL)</label>
            <input
              type="text"
              value={embed.image_url}
              onChange={(e) => onEmbed({ image_url: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="cfg-field">
            <label>Vignette (URL)</label>
            <input
              type="text"
              value={embed.thumbnail_url}
              onChange={(e) => onEmbed({ thumbnail_url: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>
        <div className="cfg-field">
          <label>Pied de page</label>
          <input
            type="text"
            value={embed.footer}
            onChange={(e) => onEmbed({ footer: e.target.value })}
            placeholder="Texte du bas"
          />
        </div>
      </div>
    </div>
  );
}

function MessagePreview({ content, embed }: { content: string; embed: Embed }) {
  const hasEmbed =
    embed.title || embed.description || embed.image_url || embed.thumbnail_url || embed.footer;
  return (
    <div className="msg-preview">
      <div className="preview-label">Aperçu</div>
      {content && <div className="preview-content">{content}</div>}
      {hasEmbed ? (
        <div className="preview-embed" style={{ borderLeftColor: embed.color || "#c9a44a" }}>
          <div className="preview-embed-main">
            <div>
              {embed.title && <div className="preview-embed-title">{embed.title}</div>}
              {embed.description && (
                <div className="preview-embed-desc">{embed.description}</div>
              )}
            </div>
            {embed.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="preview-embed-thumb" src={embed.thumbnail_url} alt="" />
            )}
          </div>
          {embed.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="preview-embed-image" src={embed.image_url} alt="" />
          )}
          {embed.footer && <div className="preview-embed-footer">{embed.footer}</div>}
        </div>
      ) : (
        !content && <div className="preview-empty">Message vide</div>
      )}
    </div>
  );
}

export default function Messages() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [tab, setTab] = useState<"unique" | "recurrents">("unique");
  const [error, setError] = useState<string | null>(null);

  // Envoi unique
  const [oneChannel, setOneChannel] = useState<string | null>(null);
  const [oneContent, setOneContent] = useState("");
  const [oneEmbed, setOneEmbed] = useState<Embed>(emptyEmbed());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Récurrents
  const [recurring, setRecurring] = useState<Recurring[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [chRes, cRes] = await Promise.all([
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/config/messages", { cache: "no-store" }),
        ]);
        if (!chRes.ok || !cRes.ok) throw new Error();
        const chData = await chRes.json();
        const cData = await cRes.json();
        setChannels(chData.channels || []);
        setRecurring(
          (cData.recurring || []).map((r: Partial<Recurring>) => ({
            ...newRecurring(),
            ...r,
            channel_id: r.channel_id != null ? String(r.channel_id) : null,
            embed: { ...emptyEmbed(), ...(r.embed || {}) },
          }))
        );
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const sendOne = useCallback(async () => {
    setSending(true);
    setSent(false);
    setError(null);
    try {
      const res = await fetch("/api/fripouille/action/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: oneChannel, content: oneContent, embed: oneEmbed }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch {
      setError("Échec de l'envoi (salon choisi ? message non vide ?).");
    } finally {
      setSending(false);
    }
  }, [oneChannel, oneContent, oneEmbed]);

  const patchRec = (id: string, patch: Partial<Recurring>) =>
    setRecurring((rs) => (rs ? rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) : rs));

  const saveRecurring = useCallback(async () => {
    if (!recurring) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload = recurring
        .filter((r) => r.channel_id && (r.content.trim() || r.embed.title || r.embed.description))
        .map((r) => ({
          id: r.id,
          enabled: r.enabled,
          channel_id: r.channel_id,
          content: r.content,
          embed: r.embed,
          interval_value: Math.max(1, Number(r.interval_value) || 1),
          interval_unit: r.interval_unit,
        }));
      const res = await fetch("/api/fripouille/config/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurring: payload }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }, [recurring]);

  if (error && !channels) return <div className="empty-state">{error}</div>;
  if (!channels || !recurring) return <div className="empty-state">Chargement…</div>;

  return (
    <div>
      <div className="tabs">
        <button
          className={`tab ${tab === "unique" ? "active" : ""}`}
          onClick={() => setTab("unique")}
        >
          ✉️ Message unique
        </button>
        <button
          className={`tab ${tab === "recurrents" ? "active" : ""}`}
          onClick={() => setTab("recurrents")}
        >
          🔁 Récurrents
        </button>
      </div>

      {tab === "unique" ? (
        <div className="msg-2col">
          <section className="cfg-card">
            <div className="cfg-field">
              <label>Salon de destination</label>
              <ChannelSelect channels={channels} value={oneChannel} onChange={setOneChannel} />
            </div>
            <MessageEditor
              content={oneContent}
              embed={oneEmbed}
              onContent={setOneContent}
              onEmbed={(p) => setOneEmbed((e) => ({ ...e, ...p }))}
            />
            <div className="cfg-actions">
              <button
                className="btn primary"
                onClick={sendOne}
                disabled={
                  sending ||
                  !oneChannel ||
                  !(oneContent.trim() || oneEmbed.title || oneEmbed.description)
                }
              >
                {sending ? "Envoi…" : "Envoyer"}
              </button>
              {sent && <span className="cfg-ok">✓ Envoyé</span>}
              {error && <span className="cfg-err">{error}</span>}
            </div>
          </section>
          <MessagePreview content={oneContent} embed={oneEmbed} />
        </div>
      ) : (
        <div className="cfg-grid wide">
          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🔁 Messages récurrents</h2>
              <p>Repostés automatiquement à la fréquence choisie.</p>
            </div>

            {recurring.length === 0 && (
              <p className="cfg-hint">Aucun message récurrent pour l'instant.</p>
            )}

            {recurring.map((r) => (
              <div className="rec-item" key={r.id}>
                <div className="rec-head">
                  <label className="cfg-toggle compact">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => patchRec(r.id, { enabled: e.target.checked })}
                    />
                    <span className="switch" />
                    <span>Actif</span>
                  </label>
                  <div className="rec-freq">
                    <span>Tous les</span>
                    <input
                      className="freq-value"
                      type="number"
                      min={1}
                      value={r.interval_value}
                      onChange={(e) =>
                        patchRec(r.id, { interval_value: Number(e.target.value) })
                      }
                    />
                    <select
                      value={r.interval_unit}
                      onChange={(e) =>
                        patchRec(r.id, { interval_unit: e.target.value as Unit })
                      }
                    >
                      {UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn icon danger"
                    onClick={() => setRecurring(recurring.filter((x) => x.id !== r.id))}
                    title="Retirer"
                  >
                    ✕
                  </button>
                </div>

                <div className="cfg-field">
                  <label>Salon</label>
                  <ChannelSelect
                    channels={channels}
                    value={r.channel_id}
                    onChange={(v) => patchRec(r.id, { channel_id: v })}
                  />
                </div>

                <MessageEditor
                  content={r.content}
                  embed={r.embed}
                  onContent={(v) => patchRec(r.id, { content: v })}
                  onEmbed={(p) => patchRec(r.id, { embed: { ...r.embed, ...p } })}
                />
                <MessagePreview content={r.content} embed={r.embed} />
              </div>
            ))}

            <div className="rec-foot">
              <button
                className="btn"
                onClick={() => setRecurring([...recurring, newRecurring()])}
              >
                + Ajouter un message récurrent
              </button>
              <div className="cfg-actions">
                <button className="btn primary" onClick={saveRecurring} disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
                {saved && <span className="cfg-ok">✓ Enregistré</span>}
                {error && <span className="cfg-err">{error}</span>}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
