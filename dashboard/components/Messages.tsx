"use client";

import { useCallback, useEffect, useState } from "react";
import MediaPicker from "@/components/MediaPicker";

// Vignette fixe des embeds « classiques » (imposée aussi côté bot).
const LOGO_URL = "https://taverne-ten.vercel.app/logo1.webp";

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
type Pub = {
  server_name: string;
  games: string;
  type: string;
  members: string;
  description: string;
  banner_url: string;
  logo_url: string;
  invite_url: string;
  color: string;
};
type Kind = "unique" | "pub";
type SentItem = {
  id: string;
  kind: Kind;
  channel_id: string;
  message_id: string;
  label: string;
  payload: { content?: string; embed?: Partial<Embed>; pub?: Partial<Pub> };
  sent_at: string;
  edited_at: string | null;
};
// Message en cours d'édition (chargé depuis l'historique).
type Editing = { message_id: string; channel_id: string } | null;

const emptyEmbed = (): Embed => ({
  title: "",
  description: "",
  color: "#c9a44a",
  image_url: "",
  thumbnail_url: "",
  footer: "",
});

const emptyPub = (): Pub => ({
  server_name: "",
  games: "",
  type: "",
  members: "",
  description: "",
  banner_url: "",
  logo_url: "",
  invite_url: "",
  color: "#c9a44a",
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
  disabled,
}: {
  channels: Channel[];
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
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
        <div className="cfg-field">
          <label>Image</label>
          <MediaPicker value={embed.image_url} onChange={(v) => onEmbed({ image_url: v })} />
        </div>
        <p className="cfg-hint">La vignette (logo de la Taverne) est ajoutée automatiquement.</p>
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
  const hasEmbed = embed.title || embed.description || embed.image_url || embed.footer;
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="preview-embed-thumb" src={LOGO_URL} alt="" />
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

function PubEditor({ pub, onPub }: { pub: Pub; onPub: (patch: Partial<Pub>) => void }) {
  return (
    <div className="msg-editor">
      <div className="pub-fields">
        <div className="cfg-field">
          <label>Nom du serveur</label>
          <input
            type="text"
            value={pub.server_name}
            onChange={(e) => onPub({ server_name: e.target.value })}
            placeholder="Ex. La Confrérie DayZ"
          />
        </div>
        <div className="cfg-field">
          <label>Jeu(x)</label>
          <input
            type="text"
            value={pub.games}
            onChange={(e) => onPub({ games: e.target.value })}
            placeholder="Ex. DayZ, Rust"
          />
        </div>
        <div className="cfg-field">
          <label>Ambiance / Type</label>
          <input
            type="text"
            value={pub.type}
            onChange={(e) => onPub({ type: e.target.value })}
            placeholder="Ex. PvP hardcore, RP…"
          />
        </div>
        <div className="cfg-field">
          <label>Nombre de membres</label>
          <input
            type="text"
            value={pub.members}
            onChange={(e) => onPub({ members: e.target.value })}
            placeholder="Ex. 320"
          />
        </div>
      </div>

      <div className="cfg-field">
        <label>Présentation</label>
        <textarea
          rows={4}
          value={pub.description}
          onChange={(e) => onPub({ description: e.target.value })}
          placeholder="Pitch du serveur (les retours à la ligne sont conservés)…"
        />
      </div>

      <div className="pub-fields">
        <div className="cfg-field">
          <label>Bannière (grande image)</label>
          <MediaPicker value={pub.banner_url} onChange={(v) => onPub({ banner_url: v })} />
        </div>
        <div className="cfg-field">
          <label>Logo du serveur (vignette)</label>
          <MediaPicker value={pub.logo_url} onChange={(v) => onPub({ logo_url: v })} />
        </div>
      </div>

      <div className="pub-fields">
        <div className="cfg-field">
          <label>Lien d'invitation</label>
          <input
            type="text"
            value={pub.invite_url}
            onChange={(e) => onPub({ invite_url: e.target.value })}
            placeholder="https://discord.gg/…"
          />
        </div>
        <div className="cfg-field">
          <label className="color-pick">
            Couleur d'accent
            <input
              type="color"
              value={pub.color || "#c9a44a"}
              onChange={(e) => onPub({ color: e.target.value })}
            />
          </label>
        </div>
      </div>
      <p className="cfg-hint">
        Le lien d'invitation devient un bouton « 🔗 Rejoindre le serveur » sous l'annonce.
        Sans logo, la vignette de la Taverne est utilisée.
      </p>
    </div>
  );
}

function PubPreview({ pub }: { pub: Pub }) {
  const hasFields = pub.games || pub.type || pub.members;
  return (
    <div className="msg-preview">
      <div className="preview-label">Aperçu</div>
      <div className="preview-embed" style={{ borderLeftColor: pub.color || "#c9a44a" }}>
        <div className="preview-embed-author">📣 Serveur partenaire</div>
        <div className="preview-embed-main">
          <div>
            <div className="preview-embed-title">{pub.server_name || "Nom du serveur"}</div>
            {pub.description && <div className="preview-embed-desc">{pub.description}</div>}
            {hasFields && (
              <div className="preview-embed-fields">
                {pub.games && (
                  <div>
                    <b>🎮 Jeu(x)</b>
                    <br />
                    {pub.games}
                  </div>
                )}
                {pub.type && (
                  <div>
                    <b>🌐 Type</b>
                    <br />
                    {pub.type}
                  </div>
                )}
                {pub.members && (
                  <div>
                    <b>👥 Membres</b>
                    <br />
                    {pub.members}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="preview-embed-thumb" src={pub.logo_url || LOGO_URL} alt="" />
        </div>
        {pub.banner_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="preview-embed-image" src={pub.banner_url} alt="" />
        )}
        <div className="preview-embed-footer">Proposé via La Fripouille</div>
      </div>
      {pub.invite_url && <div className="preview-embed-btn">🔗 Rejoindre le serveur</div>}
    </div>
  );
}

function SentHistory({
  items,
  channelName,
  editingId,
  onEdit,
  onDelete,
}: {
  items: SentItem[];
  channelName: (id: string) => string;
  editingId: string | null;
  onEdit: (item: SentItem) => void;
  onDelete: (item: SentItem) => void;
}) {
  if (items.length === 0) {
    return <p className="cfg-hint">Aucun message envoyé pour l'instant.</p>;
  }
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ""
      : d.toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  };
  return (
    <div className="sent-list">
      {items.map((it) => (
        <div className={`sent-item ${editingId === it.message_id ? "editing" : ""}`} key={it.message_id}>
          <div className="sent-meta">
            <span className="sent-label">{it.label || "Message"}</span>
            <span className="sent-sub">
              {channelName(it.channel_id)} · {fmt(it.sent_at)}
              {it.edited_at ? " · édité" : ""}
            </span>
          </div>
          <div className="sent-actions">
            <button className="btn small" onClick={() => onEdit(it)}>
              ✎ Éditer
            </button>
            <button className="btn small danger" onClick={() => onDelete(it)}>
              🗑
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Messages() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [tab, setTab] = useState<"unique" | "recurrents" | "pub">("unique");
  const [error, setError] = useState<string | null>(null);

  // Envoi unique
  const [oneChannel, setOneChannel] = useState<string | null>(null);
  const [oneContent, setOneContent] = useState("");
  const [oneEmbed, setOneEmbed] = useState<Embed>(emptyEmbed());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [editingOne, setEditingOne] = useState<Editing>(null);

  // Publicité
  const [pubChannel, setPubChannel] = useState<string | null>(null);
  const [pub, setPub] = useState<Pub>(emptyPub());
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [editingPub, setEditingPub] = useState<Editing>(null);

  // Historique des envois ponctuels (unique + pub)
  const [history, setHistory] = useState<SentItem[] | null>(null);

  // Récurrents
  const [recurring, setRecurring] = useState<Recurring[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedRec, setSavedRec] = useState(false);

  const channelName = useCallback(
    (id: string) => {
      const c = channels?.find((x) => x.id === id);
      return c ? `#${c.name}` : "salon inconnu";
    },
    [channels]
  );

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
        setHistory(cData.sent || []);
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

  // Recharge uniquement l'historique (sans écraser les récurrents en cours d'édition).
  const reloadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/fripouille/config/messages", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setHistory(d.sent || []);
      }
    } catch {
      /* silencieux */
    }
  }, []);

  const resetOne = () => {
    setOneContent("");
    setOneEmbed(emptyEmbed());
    setOneChannel(null);
    setEditingOne(null);
  };

  const sendOne = useCallback(async () => {
    setSending(true);
    setSent(false);
    setError(null);
    try {
      const url = editingOne
        ? "/api/fripouille/action/messages/edit"
        : "/api/fripouille/action/messages/send";
      const body = editingOne
        ? {
            message_id: editingOne.message_id,
            channel_id: editingOne.channel_id,
            kind: "unique",
            payload: { content: oneContent, embed: oneEmbed },
          }
        : { channel_id: oneChannel, content: oneContent, embed: oneEmbed };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSent(true);
      setTimeout(() => setSent(false), 2500);
      resetOne();
      await reloadHistory();
    } catch {
      setError(
        editingOne ? "Échec de la mise à jour." : "Échec de l'envoi (salon choisi ? message non vide ?)."
      );
    } finally {
      setSending(false);
    }
  }, [editingOne, oneChannel, oneContent, oneEmbed, reloadHistory]);

  const resetPub = () => {
    setPub(emptyPub());
    setPubChannel(null);
    setEditingPub(null);
  };

  const publishPub = useCallback(async () => {
    setPublishing(true);
    setPublished(false);
    setError(null);
    try {
      const url = editingPub
        ? "/api/fripouille/action/messages/edit"
        : "/api/fripouille/action/messages/pub";
      const body = editingPub
        ? {
            message_id: editingPub.message_id,
            channel_id: editingPub.channel_id,
            kind: "pub",
            payload: { pub },
          }
        : { channel_id: pubChannel, pub };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setPublished(true);
      setTimeout(() => setPublished(false), 2500);
      resetPub();
      await reloadHistory();
    } catch {
      setError(
        editingPub ? "Échec de la mise à jour." : "Échec de la publication (salon et nom du serveur requis)."
      );
    } finally {
      setPublishing(false);
    }
  }, [editingPub, pubChannel, pub, reloadHistory]);

  const editSent = useCallback((it: SentItem) => {
    if (it.kind === "pub") {
      setPub({ ...emptyPub(), ...(it.payload.pub || {}) });
      setPubChannel(it.channel_id);
      setEditingPub({ message_id: it.message_id, channel_id: it.channel_id });
      setTab("pub");
    } else {
      setOneContent(it.payload.content || "");
      setOneEmbed({ ...emptyEmbed(), ...(it.payload.embed || {}) });
      setOneChannel(it.channel_id);
      setEditingOne({ message_id: it.message_id, channel_id: it.channel_id });
      setTab("unique");
    }
  }, []);

  const deleteSent = useCallback(
    async (it: SentItem) => {
      setError(null);
      try {
        const res = await fetch("/api/fripouille/action/messages/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: it.message_id, channel_id: it.channel_id }),
        });
        if (!res.ok) throw new Error();
        if (editingOne?.message_id === it.message_id) resetOne();
        if (editingPub?.message_id === it.message_id) resetPub();
        await reloadHistory();
      } catch {
        setError("Échec de la suppression.");
      }
    },
    [editingOne, editingPub, reloadHistory]
  );

  const patchRec = (id: string, patch: Partial<Recurring>) =>
    setRecurring((rs) => (rs ? rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) : rs));

  const saveRecurring = useCallback(async () => {
    if (!recurring) return;
    setSaving(true);
    setSavedRec(false);
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
      setSavedRec(true);
      setTimeout(() => setSavedRec(false), 2500);
    } catch {
      setError("Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }, [recurring]);

  if (error && !channels) return <div className="empty-state">{error}</div>;
  if (!channels || !recurring || !history)
    return <div className="empty-state">Chargement…</div>;

  const uniqueHistory = history.filter((h) => h.kind === "unique");
  const pubHistory = history.filter((h) => h.kind === "pub");

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
          className={`tab ${tab === "pub" ? "active" : ""}`}
          onClick={() => setTab("pub")}
        >
          📣 PUB
        </button>
        <button
          className={`tab ${tab === "recurrents" ? "active" : ""}`}
          onClick={() => setTab("recurrents")}
        >
          🔁 Récurrents
        </button>
      </div>

      {tab === "unique" && (
        <div className="msg-2col">
          <section className="cfg-card">
            {editingOne && (
              <div className="edit-banner">
                ✎ Édition d'un message déjà envoyé
                <button className="btn small" onClick={resetOne}>
                  Annuler
                </button>
              </div>
            )}
            <div className="cfg-field">
              <label>Salon de destination</label>
              <ChannelSelect
                channels={channels}
                value={editingOne ? editingOne.channel_id : oneChannel}
                onChange={setOneChannel}
                disabled={!!editingOne}
              />
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
                  (!editingOne && !oneChannel) ||
                  !(oneContent.trim() || oneEmbed.title || oneEmbed.description)
                }
              >
                {sending ? "…" : editingOne ? "Mettre à jour" : "Envoyer"}
              </button>
              {sent && <span className="cfg-ok">✓ {editingOne ? "Mis à jour" : "Envoyé"}</span>}
              {error && <span className="cfg-err">{error}</span>}
            </div>

            <div className="cfg-card-head" style={{ marginTop: 18 }}>
              <h2>🗂️ Messages envoyés</h2>
              <p>Réédite ou supprime un message déjà posté (il est modifié en place).</p>
            </div>
            <SentHistory
              items={uniqueHistory}
              channelName={channelName}
              editingId={editingOne?.message_id ?? null}
              onEdit={editSent}
              onDelete={deleteSent}
            />
          </section>
          <MessagePreview content={oneContent} embed={oneEmbed} />
        </div>
      )}

      {tab === "pub" && (
        <div className="msg-2col">
          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>📣 Publicité — serveur partenaire</h2>
              <p>Gabarit prêt à remplir pour annoncer le serveur d'un partenaire.</p>
            </div>
            {editingPub && (
              <div className="edit-banner">
                ✎ Édition d'une pub déjà publiée
                <button className="btn small" onClick={resetPub}>
                  Annuler
                </button>
              </div>
            )}
            <div className="cfg-field">
              <label>Salon de publication</label>
              <ChannelSelect
                channels={channels}
                value={editingPub ? editingPub.channel_id : pubChannel}
                onChange={setPubChannel}
                disabled={!!editingPub}
              />
            </div>
            <PubEditor pub={pub} onPub={(p) => setPub((v) => ({ ...v, ...p }))} />
            <div className="cfg-actions">
              <button
                className="btn primary"
                onClick={publishPub}
                disabled={publishing || (!editingPub && !pubChannel) || !pub.server_name.trim()}
              >
                {publishing ? "…" : editingPub ? "Mettre à jour" : "Publier"}
              </button>
              {published && (
                <span className="cfg-ok">✓ {editingPub ? "Mis à jour" : "Publié"}</span>
              )}
              {error && <span className="cfg-err">{error}</span>}
            </div>

            <div className="cfg-card-head" style={{ marginTop: 18 }}>
              <h2>🗂️ Pubs publiées</h2>
              <p>Réédite ou retire une annonce déjà en ligne.</p>
            </div>
            <SentHistory
              items={pubHistory}
              channelName={channelName}
              editingId={editingPub?.message_id ?? null}
              onEdit={editSent}
              onDelete={deleteSent}
            />
          </section>
          <PubPreview pub={pub} />
        </div>
      )}

      {tab === "recurrents" && (
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
                {savedRec && <span className="cfg-ok">✓ Enregistré</span>}
                {error && <span className="cfg-err">{error}</span>}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
