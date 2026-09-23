"use client";

// Trois modules voisins sur un même écran (rôle d'arrivée, accueil, départ). Chacun a
// son propre brouillon : la barre du bas consigne ceux qui ont bougé, en un geste.

import { useEffect, useState } from "react";
import MediaPicker from "@/components/MediaPicker";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";

type Role = { id: string; name: string; color: number };
type Channel = { id: string; name: string; category: string | null };

type AutoroleCfg = { enabled: boolean; role_id: string | null };
type AnnonceCfg = {
  enabled: boolean;
  channel_id: string | null;
  message: string;
  image_url: string;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  role_id: "Rôle attribué",
  channel_id: "Salon d'annonce",
  message: "Texte du message",
  image_url: "Image de l'embed",
};

const normAnnonce = (raw: Record<string, unknown>): AnnonceCfg => ({
  enabled: !!raw.enabled,
  channel_id: raw.channel_id != null ? String(raw.channel_id) : null,
  message: String(raw.message || ""),
  image_url: String(raw.image_url || ""),
});

export default function Community() {
  const autorole = useModuleConfig<AutoroleCfg>("autorole", (raw) => ({
    enabled: !!raw.enabled,
    role_id: raw.role_id != null ? String(raw.role_id) : null,
  }));
  const welcome = useModuleConfig<AnnonceCfg>("welcome", normAnnonce);
  const farewell = useModuleConfig<AnnonceCfg>("farewell", normAnnonce);

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

  // Un seul état « il reste des choses à consigner » pour les trois modules.
  const dirty = autorole.dirty || welcome.dirty || farewell.dirty;
  const dirtyKeys = [
    ...autorole.dirtyKeys.map((k) => `arrivée · ${LABELS[k] || k}`),
    ...welcome.dirtyKeys.map((k) => `accueil · ${LABELS[k] || k}`),
    ...farewell.dirtyKeys.map((k) => `départ · ${LABELS[k] || k}`),
  ];
  const saving = autorole.saving || welcome.saving || farewell.saving;
  useUnsavedGuard(dirty);

  const toutConsigner = async () => {
    if (autorole.dirty) await autorole.save();
    if (welcome.dirty) await welcome.save();
    if (farewell.dirty) await farewell.save();
  };

  const toutAnnuler = () => {
    autorole.reset();
    welcome.reset();
    farewell.reset();
  };

  if (autorole.loading || welcome.loading || farewell.loading) return <Loading lignes={6} />;
  if (!autorole.draft || !welcome.draft || !farewell.draft) {
    return <Vide>{autorole.error || "La Fripouille est injoignable."}</Vide>;
  }

  const auto = autorole.draft;
  const wel = welcome.draft;
  const far = farewell.draft;
  const hex = (c: number) => (c ? `#${c.toString(16).padStart(6, "0")}` : "currentColor");

  return (
    <>
      <div className="cfg-grid">
        {/* --- Rôle d'arrivée --- */}
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="blason" /></span>
            <div>
              <h2>Rôle d&apos;arrivée</h2>
              <p>Attribue automatiquement un rôle à chaque nouveau membre du serveur.</p>
            </div>
          </div>

          <label className="cfg-toggle">
            <input
              type="checkbox"
              checked={auto.enabled}
              onChange={(e) => autorole.patch({ enabled: e.target.checked })}
            />
            <span className="switch" />
            <span>Activer l&apos;attribution automatique</span>
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
                onChange={(e) => autorole.patch({ role_id: e.target.value || null })}
              >
                <option value="">— Choisir un rôle —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            {auto.enabled && !auto.role_id && (
              <span className="hint danger-text">
                Activé sans rôle choisi : rien ne sera attribué.
              </span>
            )}
          </div>
        </section>

        {/* --- Message d'accueil --- */}
        <Annonce
          titre="Message d'accueil"
          sousTitre="Annonce l'arrivée d'un nouveau membre pour que la communauté l'accueille."
          icone="cor"
          prefixe="w"
          cfg={wel}
          patch={welcome.patch}
          channels={channels}
          placeholder="Bienvenue à {mention} à la Taverne ! 🍻"
          lignes={3}
          aide={
            <>
              Variables : <code>{"{mention}"}</code> ping le membre, <code>{"{name}"}</code>{" "}
              son pseudo, <code>{"{server}"}</code> le serveur, <code>{"{count}"}</code> le
              nombre de membres.
              <br />
              Pinguer un rôle : <code>{"<@&ID_DU_RÔLE>"}</code> · tous : <code>@everyone</code>.
            </>
          }
          aideImage="Par défaut le fond de la Taverne. Laisse vide pour n'envoyer que le texte."
        />

        {/* --- Message de départ --- */}
        <Annonce
          titre="Message de départ"
          sousTitre="Annonce quand un membre quitte le serveur."
          icone="capuche"
          prefixe="f"
          cfg={far}
          patch={farewell.patch}
          channels={channels}
          placeholder="{name} a quitté la Taverne. 👋"
          lignes={2}
          aide={
            <>
              Variables : <code>{"{name}"}</code> son pseudo, <code>{"{server}"}</code> le
              serveur, <code>{"{count}"}</code> le nombre de membres. (Le membre étant parti,
              il n&apos;est pas pingué.)
            </>
          }
          aideImage="Vide = texte seul."
        />
      </div>

      <DirtyBar
        dirty={dirty}
        dirtyKeys={dirtyKeys}
        saving={saving}
        onSave={toutConsigner}
        onReset={toutAnnuler}
      />
    </>
  );
}

function Annonce({
  titre, sousTitre, icone, prefixe, cfg, patch, channels, placeholder, lignes, aide, aideImage,
}: {
  titre: string;
  sousTitre: string;
  icone: "cor" | "capuche";
  prefixe: string;
  cfg: AnnonceCfg;
  patch: (v: Partial<AnnonceCfg>) => void;
  channels: Channel[];
  placeholder: string;
  lignes: number;
  aide: React.ReactNode;
  aideImage: string;
}) {
  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <span className="cfg-card-icon"><Icon name={icone} /></span>
        <div>
          <h2>{titre}</h2>
          <p>{sousTitre}</p>
        </div>
      </div>

      <label className="cfg-toggle">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span className="switch" />
        <span>Activer l&apos;annonce</span>
      </label>

      <div className="cfg-field">
        <label htmlFor={`${prefixe}chan`}>Salon de l&apos;annonce</label>
        <select
          id={`${prefixe}chan`}
          value={cfg.channel_id ?? ""}
          onChange={(e) => patch({ channel_id: e.target.value || null })}
        >
          <option value="">— Choisir un salon —</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}{c.category ? ` (${c.category})` : ""}
            </option>
          ))}
        </select>
        {cfg.enabled && !cfg.channel_id && (
          <span className="hint danger-text">
            Activée sans salon : le message ne partira nulle part.
          </span>
        )}
      </div>

      <div className="cfg-field">
        <label htmlFor={`${prefixe}msg`}>Message</label>
        <textarea
          id={`${prefixe}msg`}
          rows={lignes}
          value={cfg.message}
          onChange={(e) => patch({ message: e.target.value })}
          placeholder={placeholder}
        />
        <p className="cfg-hint">{aide}</p>
      </div>

      <div className="cfg-field">
        <label htmlFor={`${prefixe}img`}>Image de l&apos;embed</label>
        <MediaPicker value={cfg.image_url} onChange={(v) => patch({ image_url: v })} />
        <p className="cfg-hint">{aideImage}</p>
        {cfg.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cfg.image_url}
            alt=""
            style={{
              marginTop: 8,
              maxWidth: "100%",
              borderRadius: 8,
              border: "1px solid var(--edge)",
            }}
          />
        )}
      </div>
    </section>
  );
}
