"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { useUnsavedGuard } from "@/lib/useModuleConfig";
import { DirtyBar } from "@/components/ui";
import MediaPicker from "@/components/MediaPicker";
import { ChannelSelect, DiscordText, MentionField } from "@/components/Mentions";

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
  audio_url: string;
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
type Jeu = {
  name: string;
  style: string;
  description: string;
  price: string;
  link1_label: string;
  link1_url: string;
  link2_label: string;
  link2_url: string;
  avis: string;
  image_url: string;
  color: string;
};
type Kind = "unique" | "pub" | "jeu";
type SentItem = {
  id: string;
  kind: Kind;
  channel_id: string;
  message_id: string;
  label: string;
  payload: { content?: string; embed?: Partial<Embed>; pub?: Partial<Pub>; jeu?: Partial<Jeu>; audio_url?: string };
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

const emptyJeu = (): Jeu => ({
  name: "",
  style: "",
  description: "",
  price: "",
  link1_label: "Steam",
  link1_url: "",
  link2_label: "Instant Gaming",
  link2_url: "",
  avis: "",
  image_url: "",
  color: "#c9a44a",
});

const newRecurring = (): Recurring => ({
  id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8),
  enabled: true,
  channel_id: null,
  content: "",
  embed: emptyEmbed(),
  audio_url: "",
  interval_value: 1,
  interval_unit: "days",
});

const UNITS: { value: Unit; label: string }[] = [
  { value: "minutes", label: "minute(s)" },
  { value: "hours", label: "heure(s)" },
  { value: "days", label: "jour(s)" },
  { value: "weeks", label: "semaine(s)" },
];

function MessageEditor({
  content,
  embed,
  audio,
  onContent,
  onEmbed,
  onAudio,
}: {
  content: string;
  embed: Embed;
  audio: string;
  onContent: (v: string) => void;
  onEmbed: (patch: Partial<Embed>) => void;
  onAudio: (v: string) => void;
}) {
  return (
    <div className="msg-editor">
      <div className="cfg-field">
        <label>Texte (hors embed)</label>
        <MentionField
          multiline
          rows={2}
          max={2000}
          value={content}
          onChange={onContent}
          placeholder="Message simple — tape @ ou # pour mentionner un rôle ou un salon…"
        />
        <p className="cfg-hint">
          Seules les mentions de ce champ pingent. Un rôle non « mentionnable » ne sonne que si
          La Fripouille a la permission « Mentionner @everyone, @here et tous les rôles ».
        </p>
      </div>

      <div className="cfg-field">
        <label>Audio joint</label>
        <MediaPicker value={audio} onChange={onAudio} kind="audio" />
        <p className="cfg-hint">
          Le fichier est envoyé en pièce jointe (lecteur audio natif Discord), en plus du texte
          et de l'embed.
        </p>
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
            maxLength={256}
            value={embed.title}
            onChange={(e) => onEmbed({ title: e.target.value })}
            placeholder="Titre de l'embed"
          />
        </div>
        <div className="cfg-field">
          <label>Description</label>
          <MentionField
            multiline
            embed
            rows={4}
            max={4096}
            value={embed.description}
            onChange={(v) => onEmbed({ description: v })}
            placeholder="Corps de l'embed (**gras**, *italique*, retours à la ligne conservés)"
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

function MessagePreview({
  content,
  embed,
  audio,
  labelFor,
}: {
  content: string;
  embed: Embed;
  audio?: string;
  labelFor?: (url: string) => string;
}) {
  const hasEmbed = embed.title || embed.description || embed.image_url || embed.footer;
  return (
    <div className="msg-preview">
      <div className="preview-label">Aperçu</div>
      {content && (
        <div className="preview-content">
          <DiscordText text={content} />
        </div>
      )}
      {audio && (
        <div className="preview-content">🎵 {labelFor ? labelFor(audio) : audio.split("/").pop()}</div>
      )}
      {hasEmbed ? (
        <div className="preview-embed" style={{ borderLeftColor: embed.color || "#c9a44a" }}>
          <div className="preview-embed-main">
            <div>
              {embed.title && <div className="preview-embed-title">{embed.title}</div>}
              {embed.description && (
                <div className="preview-embed-desc">
                  <DiscordText text={embed.description} />
                </div>
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
        !content && !audio && <div className="preview-empty">Message vide</div>
      )}
    </div>
  );
}

function PubEditor({
  pub,
  audio,
  onPub,
  onAudio,
}: {
  pub: Pub;
  audio: string;
  onPub: (patch: Partial<Pub>) => void;
  onAudio: (v: string) => void;
}) {
  return (
    <div className="msg-editor">
      <div className="cfg-field">
        <label>Audio joint</label>
        <MediaPicker value={audio} onChange={onAudio} kind="audio" />
        <p className="cfg-hint">Le fichier est envoyé en pièce jointe, en plus de l'annonce.</p>
      </div>

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
        <MentionField
          multiline
          embed
          rows={4}
          max={4096}
          value={pub.description}
          onChange={(v) => onPub({ description: v })}
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

function PubPreview({
  pub,
  audio,
  labelFor,
}: {
  pub: Pub;
  audio?: string;
  labelFor?: (url: string) => string;
}) {
  const hasFields = pub.games || pub.type || pub.members;
  return (
    <div className="msg-preview">
      <div className="preview-label">Aperçu</div>
      {audio && (
        <div className="preview-content">🎵 {labelFor ? labelFor(audio) : audio.split("/").pop()}</div>
      )}
      <div className="preview-embed" style={{ borderLeftColor: pub.color || "#c9a44a" }}>
        <div className="preview-embed-author">📣 Serveur partenaire</div>
        <div className="preview-embed-main">
          <div>
            <div className="preview-embed-title">{pub.server_name || "Nom du serveur"}</div>
            {pub.description && (
              <div className="preview-embed-desc">
                <DiscordText text={pub.description} />
              </div>
            )}
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

function JeuEditor({ jeu, onJeu }: { jeu: Jeu; onJeu: (patch: Partial<Jeu>) => void }) {
  const champ = (k: keyof Jeu, label: string, placeholder: string) => (
    <div className="cfg-field">
      <label>{label}</label>
      <input type="text" value={jeu[k]} onChange={(e) => onJeu({ [k]: e.target.value })} placeholder={placeholder} />
    </div>
  );
  return (
    <div className="msg-editor">
      <div className="pub-fields">
        {champ("name", "Nom du jeu", "Ex. Red Dead Redemption 2")}
        {champ("style", "Style", "Ex. Action-aventure, open world")}
      </div>
      <div className="cfg-field">
        <label>Présentation</label>
        <MentionField
          multiline
          embed
          rows={4}
          max={4096}
          value={jeu.description}
          onChange={(v) => onJeu({ description: v })}
          placeholder="Pitch du jeu (les retours à la ligne sont conservés)…"
        />
      </div>
      <div className="pub-fields">
        {champ("price", "Tarif", "Ex. 59,99 € (−70 % en ce moment)")}
        <div className="cfg-field">
          <label className="color-pick">
            Couleur d&apos;accent
            <input type="color" value={jeu.color || "#c9a44a"} onChange={(e) => onJeu({ color: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="pub-fields">
        {champ("link1_label", "Bouton 1 — libellé", "Steam")}
        {champ("link1_url", "Bouton 1 — lien d'achat", "https://store.steampowered.com/…")}
      </div>
      <div className="pub-fields">
        {champ("link2_label", "Bouton 2 — libellé", "Instant Gaming")}
        {champ("link2_url", "Bouton 2 — lien d'achat", "https://www.instant-gaming.com/…")}
      </div>
      <div className="cfg-field">
        <label>Avis de la commu</label>
        <MentionField
          multiline
          embed
          rows={3}
          max={1024}
          value={jeu.avis}
          onChange={(v) => onJeu({ avis: v })}
          placeholder="« Une pépite, 200 h au compteur » — Pseudo"
        />
      </div>
      <div className="cfg-field">
        <label>Image</label>
        <MediaPicker value={jeu.image_url} onChange={(v) => onJeu({ image_url: v })} />
      </div>
      <p className="cfg-hint">
        Un bouton sans lien n&apos;est pas affiché. La vignette de la Taverne est ajoutée automatiquement.
      </p>
    </div>
  );
}

function JeuPreview({ jeu }: { jeu: Jeu }) {
  const liens = [
    { label: jeu.link1_label || "Steam", url: jeu.link1_url },
    { label: jeu.link2_label || "Instant Gaming", url: jeu.link2_url },
  ].filter((l) => /^https?:\/\//.test(l.url.trim()));
  return (
    <div className="msg-preview">
      <div className="preview-label">Aperçu</div>
      <div className="preview-embed" style={{ borderLeftColor: jeu.color || "#c9a44a" }}>
        <div className="preview-embed-author">🎮 Le jeu à découvrir</div>
        <div className="preview-embed-main">
          <div>
            <div className="preview-embed-title">{jeu.name || "Nom du jeu"}</div>
            {jeu.description && (
              <div className="preview-embed-desc">
                <DiscordText text={jeu.description} />
              </div>
            )}
            {(jeu.style || jeu.price) && (
              <div className="preview-embed-fields">
                {jeu.style && (
                  <div>
                    <b>🏷️ Style</b>
                    <br />
                    {jeu.style}
                  </div>
                )}
                {jeu.price && (
                  <div>
                    <b>💰 Tarif</b>
                    <br />
                    {jeu.price}
                  </div>
                )}
              </div>
            )}
            {jeu.avis && (
              <div className="preview-embed-desc" style={{ marginTop: 8 }}>
                <b>💬 Avis de la commu</b>
                <br />
                <DiscordText text={jeu.avis} />
              </div>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="preview-embed-thumb" src={LOGO_URL} alt="" />
        </div>
        {jeu.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="preview-embed-image" src={jeu.image_url} alt="" />
        )}
        <div className="preview-embed-footer">Proposé via La Fripouille</div>
      </div>
      {liens.map((l, i) => (
        <div key={i} className="preview-embed-btn">
          🛒 {l.label}
        </div>
      ))}
    </div>
  );
}

function SentHistory({
  items,
  channelName,
  editingId,
  onEdit,
  onCopy,
  onDelete,
}: {
  items: SentItem[];
  channelName: (id: string) => string;
  editingId: string | null;
  onEdit: (item: SentItem) => void;
  onCopy: (item: SentItem) => void;
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
            <button className="btn small" onClick={() => onCopy(it)} title="Repartir de ce message pour un nouvel envoi">
              ⧉ Reprendre
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
  const [tab, setTab] = useState<"unique" | "recurrents" | "pub" | "jeu">("unique");
  const [error, setError] = useState<string | null>(null);
  const [mediaLabels, setMediaLabels] = useState<Record<string, string>>({});

  // Envoi unique
  const [oneChannel, setOneChannel] = useState<string | null>(null);
  const [oneContent, setOneContent] = useState("");
  const [oneEmbed, setOneEmbed] = useState<Embed>(emptyEmbed());
  const [oneAudio, setOneAudio] = useState("");
  const [sending, setSending] = useState(false);
  const toasts = useToasts();
  const [editingOne, setEditingOne] = useState<Editing>(null);

  // Publicité
  const [pubChannel, setPubChannel] = useState<string | null>(null);
  const [pub, setPub] = useState<Pub>(emptyPub());
  const [pubAudio, setPubAudio] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [editingPub, setEditingPub] = useState<Editing>(null);

  // Promo jeu
  const [jeuChannel, setJeuChannel] = useState<string | null>(null);
  const [jeu, setJeu] = useState<Jeu>(emptyJeu());
  const [publishingJeu, setPublishingJeu] = useState(false);
  const [editingJeu, setEditingJeu] = useState<Editing>(null);

  // Historique des envois ponctuels (unique + pub)
  const [history, setHistory] = useState<SentItem[] | null>(null);

  // Récurrents
  const [recurring, setRecurring] = useState<Recurring[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Instantané du dernier état enregistré : c'est lui qui dit si un brouillon traîne.
  const [recSnapshot, setRecSnapshot] = useState<Recurring[] | null>(null);

  const channelName = useCallback(
    (id: string) => {
      const c = channels?.find((x) => x.id === id);
      return c ? `#${c.name}` : "salon inconnu";
    },
    [channels]
  );

  const audioLabel = useCallback(
    (url: string) => mediaLabels[url] || url.split("/").pop() || url,
    [mediaLabels]
  );

  useEffect(() => {
    (async () => {
      try {
        const [chRes, cRes, mRes] = await Promise.all([
          fetch("/api/fripouille/channels", { cache: "no-store" }),
          fetch("/api/fripouille/config/messages", { cache: "no-store" }),
          fetch("/api/fripouille/media", { cache: "no-store" }),
        ]);
        if (!chRes.ok || !cRes.ok) throw new Error();
        const chData = await chRes.json();
        const cData = await cRes.json();
        setChannels(chData.channels || []);
        setHistory(cData.sent || []);
        if (mRes.ok) {
          const mData = await mRes.json();
          const map: Record<string, string> = {};
          for (const it of mData.media || []) map[it.url] = it.label || it.name;
          setMediaLabels(map);
        }
        const recus = (cData.recurring || []).map((r: Partial<Recurring>) => ({
          ...newRecurring(),
          ...r,
          channel_id: r.channel_id != null ? String(r.channel_id) : null,
          embed: { ...emptyEmbed(), ...(r.embed || {}) },
          audio_url: r.audio_url || "",
        }));
        setRecurring(recus);
        setRecSnapshot(recus);
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
    setOneAudio("");
    setOneChannel(null);
    setEditingOne(null);
  };

  const sendOne = useCallback(async () => {
    setSending(true);
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
            payload: { content: oneContent, embed: oneEmbed, audio_url: oneAudio },
          }
        : { channel_id: oneChannel, content: oneContent, embed: oneEmbed, audio_url: oneAudio };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toasts.ok(editingOne ? "Message mis à jour" : "Message envoyé");
      resetOne();
      await reloadHistory();
    } catch {
      setError(
        editingOne ? "Échec de la mise à jour." : "Échec de l'envoi (salon choisi ? message non vide ?)."
      );
    } finally {
      setSending(false);
    }
  }, [editingOne, oneChannel, oneContent, oneEmbed, oneAudio, reloadHistory]);

  const resetPub = () => {
    setPub(emptyPub());
    setPubAudio("");
    setPubChannel(null);
    setEditingPub(null);
  };

  const publishPub = useCallback(async () => {
    setPublishing(true);
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
            payload: { pub, audio_url: pubAudio },
          }
        : { channel_id: pubChannel, pub, audio_url: pubAudio };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toasts.ok(editingPub ? "Annonce mise à jour" : "Annonce publiée");
      resetPub();
      await reloadHistory();
    } catch {
      setError(
        editingPub ? "Échec de la mise à jour." : "Échec de la publication (salon et nom du serveur requis)."
      );
    } finally {
      setPublishing(false);
    }
  }, [editingPub, pubChannel, pub, pubAudio, reloadHistory]);

  const resetJeu = () => {
    setJeu(emptyJeu());
    setJeuChannel(null);
    setEditingJeu(null);
  };

  const publishJeu = useCallback(async () => {
    setPublishingJeu(true);
    setError(null);
    try {
      const url = editingJeu ? "/api/fripouille/action/messages/edit" : "/api/fripouille/action/messages/jeu";
      const body = editingJeu
        ? { message_id: editingJeu.message_id, channel_id: editingJeu.channel_id, kind: "jeu", payload: { jeu } }
        : { channel_id: jeuChannel, jeu };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toasts.ok(editingJeu ? "Promo mise à jour" : "Promo publiée");
      resetJeu();
      await reloadHistory();
    } catch {
      setError(editingJeu ? "Échec de la mise à jour." : "Échec de la publication (salon et nom du jeu requis).");
    } finally {
      setPublishingJeu(false);
    }
  }, [editingJeu, jeuChannel, jeu, reloadHistory]);

  // copie = on recharge le contenu comme brouillon d'un NOUVEL envoi (salon modifiable).
  const loadSent = useCallback((it: SentItem, copie: boolean) => {
    const cible = copie ? null : { message_id: it.message_id, channel_id: it.channel_id };
    if (it.kind === "jeu") {
      setJeu({ ...emptyJeu(), ...(it.payload.jeu || {}) });
      setJeuChannel(it.channel_id);
      setEditingJeu(cible);
      setTab("jeu");
    } else if (it.kind === "pub") {
      setPub({ ...emptyPub(), ...(it.payload.pub || {}) });
      setPubAudio(it.payload.audio_url || "");
      setPubChannel(it.channel_id);
      setEditingPub(cible);
      setTab("pub");
    } else {
      setOneContent(it.payload.content || "");
      setOneEmbed({ ...emptyEmbed(), ...(it.payload.embed || {}) });
      setOneAudio(it.payload.audio_url || "");
      setOneChannel(it.channel_id);
      setEditingOne(cible);
      setTab("unique");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const editSent = useCallback((it: SentItem) => loadSent(it, false), [loadSent]);
  const copySent = useCallback((it: SentItem) => loadSent(it, true), [loadSent]);

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
        if (editingJeu?.message_id === it.message_id) resetJeu();
        await reloadHistory();
      } catch {
        setError("Échec de la suppression.");
      }
    },
    [editingOne, editingPub, editingJeu, reloadHistory]
  );

  const patchRec = (id: string, patch: Partial<Recurring>) =>
    setRecurring((rs) => (rs ? rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) : rs));

  const saveRecurring = useCallback(async () => {
    if (!recurring) return;
    setSaving(true);
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
          audio_url: r.audio_url,
          interval_value: Math.max(1, Number(r.interval_value) || 1),
          interval_unit: r.interval_unit,
        }));
      const res = await fetch("/api/fripouille/config/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurring: payload }),
      });
      if (!res.ok) throw new Error();
      setRecSnapshot(recurring);
      toasts.ok("Récurrents consignés", "Le planificateur repart sur les nouveaux délais.");
    } catch {
      setError("Échec de l'enregistrement.");
      toasts.err("Rien n'a été enregistré", "Tes récurrents sont toujours là, à l'écran.");
    } finally {
      setSaving(false);
    }
  }, [recurring, toasts]);

  // Les envois partent tout de suite ; seuls les récurrents sont un brouillon qu'on
  // peut perdre — c'est donc le seul état que la barre et le garde-fou surveillent.
  const recDirty = useMemo(
    () => !!recSnapshot && JSON.stringify(recurring) !== JSON.stringify(recSnapshot),
    [recurring, recSnapshot]
  );
  useUnsavedGuard(recDirty);

  if (error && !channels) return <div className="empty-state">{error}</div>;
  if (!channels || !recurring || !history)
    return <div className="empty-state">Chargement…</div>;

  const uniqueHistory = history.filter((h) => h.kind === "unique");
  const pubHistory = history.filter((h) => h.kind === "pub");
  const jeuHistory = history.filter((h) => h.kind === "jeu");

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
          className={`tab ${tab === "jeu" ? "active" : ""}`}
          onClick={() => setTab("jeu")}
        >
          🎮 Promo jeu
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
              audio={oneAudio}
              onContent={setOneContent}
              onEmbed={(p) => setOneEmbed((e) => ({ ...e, ...p }))}
              onAudio={setOneAudio}
            />
            <div className="cfg-actions">
              <button
                className="btn primary"
                onClick={sendOne}
                disabled={
                  sending ||
                  (!editingOne && !oneChannel) ||
                  oneContent.length > 2000 ||
                  oneEmbed.description.length > 4096 ||
                  !(oneContent.trim() || oneEmbed.title || oneEmbed.description || oneAudio)
                }
              >
                {sending ? "…" : editingOne ? "Mettre à jour" : "Envoyer"}
              </button>
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
              onCopy={copySent}
              onDelete={deleteSent}
            />
          </section>
          <MessagePreview content={oneContent} embed={oneEmbed} audio={oneAudio} labelFor={audioLabel} />
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
            <PubEditor
              pub={pub}
              audio={pubAudio}
              onPub={(p) => setPub((v) => ({ ...v, ...p }))}
              onAudio={setPubAudio}
            />
            <div className="cfg-actions">
              <button
                className="btn primary"
                onClick={publishPub}
                disabled={publishing || (!editingPub && !pubChannel) || !pub.server_name.trim()}
              >
                {publishing ? "…" : editingPub ? "Mettre à jour" : "Publier"}
              </button>
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
              onCopy={copySent}
              onDelete={deleteSent}
            />
          </section>
          <PubPreview pub={pub} audio={pubAudio} labelFor={audioLabel} />
        </div>
      )}

      {tab === "jeu" && (
        <div className="msg-2col">
          <section className="cfg-card">
            <div className="cfg-card-head">
              <h2>🎮 Promo jeu</h2>
              <p>Fiche d&apos;un jeu à faire découvrir, avec ses boutons d&apos;achat.</p>
            </div>
            {editingJeu && (
              <div className="edit-banner">
                ✎ Édition d&apos;une promo déjà publiée
                <button className="btn small" onClick={resetJeu}>
                  Annuler
                </button>
              </div>
            )}
            <div className="cfg-field">
              <label>Salon de publication</label>
              <ChannelSelect
                channels={channels}
                value={editingJeu ? editingJeu.channel_id : jeuChannel}
                onChange={setJeuChannel}
                disabled={!!editingJeu}
              />
            </div>
            <JeuEditor jeu={jeu} onJeu={(p) => setJeu((v) => ({ ...v, ...p }))} />
            <div className="cfg-actions">
              <button
                className="btn primary"
                onClick={publishJeu}
                disabled={publishingJeu || (!editingJeu && !jeuChannel) || !jeu.name.trim()}
              >
                {publishingJeu ? "…" : editingJeu ? "Mettre à jour" : "Publier"}
              </button>
            </div>

            <div className="cfg-card-head" style={{ marginTop: 18 }}>
              <h2>🗂️ Promos publiées</h2>
              <p>Réédite ou retire une promo déjà en ligne.</p>
            </div>
            <SentHistory
              items={jeuHistory}
              channelName={channelName}
              editingId={editingJeu?.message_id ?? null}
              onEdit={editSent}
              onCopy={copySent}
              onDelete={deleteSent}
            />
          </section>
          <JeuPreview jeu={jeu} />
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
                  audio={r.audio_url}
                  onContent={(v) => patchRec(r.id, { content: v })}
                  onEmbed={(p) => patchRec(r.id, { embed: { ...r.embed, ...p } })}
                  onAudio={(v) => patchRec(r.id, { audio_url: v })}
                />
                <MessagePreview content={r.content} embed={r.embed} audio={r.audio_url} labelFor={audioLabel} />
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
                  <Icon name="sceau" />
                  {saving ? "Consignation…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "recurrents" && (
        <DirtyBar
          dirty={recDirty}
          dirtyKeys={["messages récurrents"]}
          saving={saving}
          onSave={saveRecurring}
          onReset={() => recSnapshot && setRecurring(recSnapshot)}
        />
      )}
    </div>
  );
}
