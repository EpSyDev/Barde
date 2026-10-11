"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide, depuis } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";

type Twitch = { login: string; nom: string };
type Youtube = { channel_id: string; nom: string };
type Cfg = {
  enabled: boolean;
  channel_id: string | null;
  ping_role_id: string | null;
  twitch: Twitch[];
  youtube: Youtube[];
  twitch_intervalle_min: number;
};
type Etat = {
  twitch_configure: boolean;
  derniere: { twitch: string | null; youtube: string | null };
  erreurs: { twitch: string | null; youtube: string | null };
  lives: Record<string, { titre?: string; jeu?: string; spectateurs?: number }>;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon d'annonce",
  ping_role_id: "Rôle pingé",
  twitch: "Chaînes Twitch",
  youtube: "Chaînes YouTube",
  twitch_intervalle_min: "Fréquence de vérification",
};

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  ping_role_id: d.ping_role_id != null ? String(d.ping_role_id) : null,
  twitch: Array.isArray(d.twitch) ? (d.twitch as Twitch[]) : [],
  youtube: Array.isArray(d.youtube) ? (d.youtube as Youtube[]) : [],
  twitch_intervalle_min: Number(d.twitch_intervalle_min ?? 3),
});
// `etat` (mémoire du bot) n'est volontairement pas renvoyé : le bot en reste propriétaire.
const serialize = (c: Cfg) => ({ ...c, twitch_intervalle_min: Math.max(1, Math.round(c.twitch_intervalle_min) || 1) });

async function action(nom: string, payload: object = {}) {
  const r = await fetch(`/api/fripouille/action/diffusions/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

/** Annonces de lives Twitch et de nouvelles vidéos YouTube dans un salon. */
export default function Diffusions() {
  const mod = useModuleConfig<Cfg>("diffusions", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const [etat, setEtat] = useState<Etat | null>(null);
  const [login, setLogin] = useState("");
  const [yt, setYt] = useState("");
  const [ytNom, setYtNom] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setEtat(await action("etat"));
    } catch {
      /* silencieux */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, [charger]);

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const ajouterTwitch = () => {
    const l = login.trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9_]{3,25}$/.test(l)) return setNote("⚠️ Pseudo Twitch invalide (3 à 25 caractères : lettres, chiffres, _).");
    if (d.twitch.some((t) => t.login === l)) return setNote("⚠️ Déjà dans la liste.");
    setNote(null);
    mod.patch({ twitch: [...d.twitch, { login: l, nom: "" }] });
    setLogin("");
  };
  const ajouterYoutube = async () => {
    setNote(null);
    try {
      const j = await action("resoudre_youtube", { valeur: yt });
      if (d.youtube.some((y) => y.channel_id === j.channel_id)) return setNote("⚠️ Déjà dans la liste.");
      mod.patch({ youtube: [...d.youtube, { channel_id: j.channel_id, nom: ytNom.trim() }] });
      setYt("");
      setYtNom("");
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    }
  };
  const tester = async () => {
    try {
      await action("tester");
      setNote("✅ Message de test envoyé dans le salon (enregistre d'abord le salon si besoin).");
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    }
  };

  return (
    <div className="cfg-grid wide">
      {etat && !etat.twitch_configure && d.twitch.length > 0 && (
        <div className="edit-banner">
          ⚠️ Twitch n&apos;est pas configuré : crée une application sur dev.twitch.tv puis ajoute
          <code> TWITCH_CLIENT_ID </code> et <code> TWITCH_CLIENT_SECRET </code> au .env de la VM (puis redémarre le bot).
          YouTube fonctionne sans clé.
        </div>
      )}
      {etat?.erreurs.twitch && etat.twitch_configure && <div className="edit-banner">⚠️ Twitch : {etat.erreurs.twitch}</div>}
      {etat?.erreurs.youtube && <div className="edit-banner">⚠️ {etat.erreurs.youtube}</div>}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="eclair" />
          </span>
          <div>
            <h2>Lives & vidéos</h2>
            <p>
              Une annonce dès qu&apos;une chaîne suivie passe en direct sur Twitch ou publie une vidéo sur YouTube. L&apos;état
              actuel des chaînes est mémorisé à l&apos;ajout : seules les nouveautés sont annoncées.
            </p>
          </div>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer les annonces</span>
        </label>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon d&apos;annonce</label>
            <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle pingé</label>
            <select value={d.ping_role_id ?? ""} onChange={(e) => mod.patch({ ping_role_id: e.target.value || null })}>
              <option value="">— Aucun —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="cfg-field">
          <label>Vérifier les lives toutes les (minutes)</label>
          <input type="text" inputMode="numeric" value={d.twitch_intervalle_min} onChange={(e) => mod.patch({ twitch_intervalle_min: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
        <button className="btn small" type="button" onClick={tester}>Envoyer un message de test</button>
        {note && <p className="cfg-hint">{note}</p>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>🟣 Chaînes Twitch</h2></div>
        {d.twitch.length === 0 ? (
          <p className="cfg-hint">Aucune chaîne suivie.</p>
        ) : (
          <div className="game-list">
            {d.twitch.map((t) => {
              const live = etat?.lives[t.login];
              return (
                <div className="game-row" key={t.login} style={{ gap: 8 }}>
                  <span className="game-label">
                    <b>{t.login}</b> {live ? `🔴 en direct — ${live.titre ?? ""} (${live.jeu ?? "?"}, ${live.spectateurs ?? 0} spect.)` : ""}
                  </span>
                  <button className="btn icon danger" type="button" aria-label="Retirer" onClick={() => mod.patch({ twitch: d.twitch.filter((x) => x.login !== t.login) })}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="field-2col">
          <div className="cfg-field">
            <label>Pseudo ou URL Twitch</label>
            <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ajouterTwitch()} placeholder="ex. monstreamer" />
          </div>
          <div className="cfg-field">
            <label>&nbsp;</label>
            <button className="btn" type="button" disabled={!login} onClick={ajouterTwitch}>➕ Ajouter</button>
          </div>
        </div>
        {etat?.derniere.twitch && <p className="cfg-hint">Dernière vérification {depuis(etat.derniere.twitch)}.</p>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>🔴 Chaînes YouTube</h2></div>
        {d.youtube.length === 0 ? (
          <p className="cfg-hint">Aucune chaîne suivie.</p>
        ) : (
          <div className="game-list">
            {d.youtube.map((y) => (
              <div className="game-row" key={y.channel_id} style={{ gap: 8 }}>
                <span className="game-label">
                  <b>{y.nom || "Chaîne"}</b> <code>{y.channel_id}</code>
                </span>
                <button className="btn icon danger" type="button" aria-label="Retirer" onClick={() => mod.patch({ youtube: d.youtube.filter((x) => x.channel_id !== y.channel_id) })}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="field-2col">
          <div className="cfg-field">
            <label>URL de la chaîne (youtube.com/@nom) ou identifiant UC…</label>
            <input type="text" value={yt} onChange={(e) => setYt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ajouterYoutube()} />
          </div>
          <div className="cfg-field">
            <label>Nom (facultatif)</label>
            <input type="text" maxLength={60} value={ytNom} onChange={(e) => setYtNom(e.target.value)} />
          </div>
        </div>
        <button className="btn" type="button" disabled={!yt} onClick={ajouterYoutube}>➕ Ajouter la chaîne</button>
        <p className="cfg-hint">Les vidéos sont vérifiées toutes les 10 minutes.</p>
      </section>

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
