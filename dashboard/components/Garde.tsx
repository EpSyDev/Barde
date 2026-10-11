"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide, depuis } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";
import Parchemin from "@/components/Parchemin";

type Cfg = {
  enabled: boolean;
  alert_channel_id: string | null;
  alert_role_id: string | null;
  arrivees_seuil: number;
  arrivees_fenetre_s: number;
  auto_timeout: boolean;
  timeout_minutes: number;
  auto_verrou: boolean;
  verrou_duree_min: number;
  flood_actif: boolean;
  flood_messages: number;
  flood_fenetre_s: number;
  mentions_seuil: number;
  flood_timeout_min: number;
};
type Verrou = { actif?: boolean; depuis?: string; par?: string };
type Etat = {
  verrou: Verrou;
  arrivees_fenetre: number;
  perms: { manage_guild?: boolean; moderate_members?: boolean; manage_messages?: boolean };
  alertes: { quand: string; titre: string; texte: string }[];
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  alert_channel_id: "Salon d'alerte",
  alert_role_id: "Rôle à pinger",
  arrivees_seuil: "Seuil d'arrivées",
  arrivees_fenetre_s: "Fenêtre d'arrivées",
  auto_timeout: "Exclusion auto des arrivants",
  timeout_minutes: "Durée d'exclusion",
  auto_verrou: "Verrouillage auto",
  verrou_duree_min: "Durée du verrou",
  flood_actif: "Anti-flood",
  flood_messages: "Messages max",
  flood_fenetre_s: "Fenêtre de flood",
  mentions_seuil: "Seuil de mentions",
  flood_timeout_min: "Exclusion flood",
};

const n = (d: Record<string, unknown>, k: string, def: number) => Number(d[k] ?? def);
const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  alert_channel_id: d.alert_channel_id != null ? String(d.alert_channel_id) : null,
  alert_role_id: d.alert_role_id != null ? String(d.alert_role_id) : null,
  arrivees_seuil: n(d, "arrivees_seuil", 8),
  arrivees_fenetre_s: n(d, "arrivees_fenetre_s", 60),
  auto_timeout: !!d.auto_timeout,
  timeout_minutes: n(d, "timeout_minutes", 60),
  auto_verrou: !!d.auto_verrou,
  verrou_duree_min: n(d, "verrou_duree_min", 30),
  flood_actif: d.flood_actif !== false,
  flood_messages: n(d, "flood_messages", 8),
  flood_fenetre_s: n(d, "flood_fenetre_s", 8),
  mentions_seuil: n(d, "mentions_seuil", 6),
  flood_timeout_min: n(d, "flood_timeout_min", 10),
});
const serialize = (c: Cfg) => ({
  ...c,
  arrivees_seuil: Math.max(2, Math.round(c.arrivees_seuil) || 2),
  arrivees_fenetre_s: Math.max(5, Math.round(c.arrivees_fenetre_s) || 5),
  timeout_minutes: Math.max(1, Math.round(c.timeout_minutes) || 1),
  verrou_duree_min: Math.max(0, Math.round(c.verrou_duree_min) || 0),
  flood_messages: Math.max(3, Math.round(c.flood_messages) || 3),
  flood_fenetre_s: Math.max(2, Math.round(c.flood_fenetre_s) || 2),
  mentions_seuil: Math.max(2, Math.round(c.mentions_seuil) || 2),
  flood_timeout_min: Math.max(1, Math.round(c.flood_timeout_min) || 1),
});

async function action(nom: string, payload: object = {}) {
  const r = await fetch(`/api/fripouille/action/garde/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

/** Anti-raid : détection d'arrivées en masse / flood, verrouillage d'urgence du serveur. */
export default function Garde() {
  const mod = useModuleConfig<Cfg>("garde", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const [etat, setEtat] = useState<Etat | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setEtat(await action("etat"));
    } catch {
      /* silencieux */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 10000);
    return () => clearInterval(t);
  }, [charger]);

  const lancer = async (nom: string, payload: object, confirmation: string | null, ok: (j: Record<string, unknown>) => string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setOccupe(true);
    setNote(null);
    try {
      const j = await action(nom, payload);
      setNote(`✅ ${ok(j)}`);
      await charger();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
    }
  };

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  const verrouille = !!etat?.verrou?.actif;
  const p = etat?.perms;
  const permsManquantes = p
    ? [
        !p.manage_guild && "Gérer le serveur (verrou)",
        !p.moderate_members && "Exclure des membres (timeouts)",
        !p.manage_messages && "Gérer les messages (flood)",
      ].filter(Boolean)
    : [];

  return (
    <div className="cfg-grid wide">
      {verrouille && (
        <div className="edit-banner">
          🔒 Serveur verrouillé {etat?.verrou.depuis ? depuis(etat.verrou.depuis) : ""} par {etat?.verrou.par || "?"} :
          invitations en pause, vérification au maximum.
        </div>
      )}
      {permsManquantes.length > 0 && (
        <div className="edit-banner">
          ⚠️ Permissions manquantes pour le bot : {permsManquantes.join(", ")}.
        </div>
      )}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="bouclier" />
          </span>
          <div>
            <h2>Urgence</h2>
            <p>
              Réagis en un clic. Le verrouillage met les invitations en pause et monte la vérification au
              maximum ; le déverrouillage restaure l&apos;état d&apos;avant.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {verrouille ? (
            <button className="btn primary" type="button" disabled={occupe}
              onClick={() => lancer("deverrouiller", {}, null, () => "Serveur déverrouillé.")}>
              🔓 Déverrouiller le serveur
            </button>
          ) : (
            <button className="btn danger" type="button" disabled={occupe}
              onClick={() => lancer("verrouiller", {}, "Verrouiller le serveur : invitations en pause et vérification maximale ?", () => "Serveur verrouillé.")}>
              🔒 Verrouiller le serveur
            </button>
          )}
          <button className="btn" type="button" disabled={occupe}
            onClick={() => lancer("neutraliser", { depuis_min: 10, minutes: d.timeout_minutes },
              `Exclure ${d.timeout_minutes} min tous les membres arrivés depuis moins de 10 minutes ?`,
              (j) => `${j.exclus} membre(s) exclu(s).`)}>
            🧊 Neutraliser les arrivants (10 min)
          </button>
          <button className="btn ghost" type="button" disabled={occupe}
            onClick={() => lancer("tester", {}, null, () => "Alerte de test envoyée.")}>
            Tester l&apos;alerte
          </button>
        </div>
        {note && <p className="cfg-hint">{note}</p>}
        <p className="cfg-hint">
          Arrivées sur la fenêtre de détection : <b>{etat?.arrivees_fenetre ?? "—"}</b> / seuil {d.arrivees_seuil}.
        </p>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Détection</h2>
          <p>Alerte dans un salon staff dès qu&apos;un comportement de raid est repéré.</p>
        </div>

        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer la garde</span>
        </label>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon d&apos;alerte (staff)</label>
            <ChannelSelect channels={channels} value={d.alert_channel_id} onChange={(v) => mod.patch({ alert_channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle à pinger</label>
            <select value={d.alert_role_id ?? ""} onChange={(e) => mod.patch({ alert_role_id: e.target.value || null })}>
              <option value="">— Aucun —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h3>Pic d&apos;arrivées</h3>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Seuil (arrivées)</label>
            <input type="text" inputMode="numeric" value={d.arrivees_seuil} onChange={(e) => mod.patch({ arrivees_seuil: num(e.target.value) })} />
          </div>
          <div className="cfg-field">
            <label>Fenêtre (secondes)</label>
            <input type="text" inputMode="numeric" value={d.arrivees_fenetre_s} onChange={(e) => mod.patch({ arrivees_fenetre_s: num(e.target.value) })} />
          </div>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.auto_timeout} onChange={(e) => mod.patch({ auto_timeout: e.target.checked })} />
          <span className="switch" />
          <span>Exclure automatiquement les arrivants du pic</span>
        </label>
        {d.auto_timeout && (
          <div className="cfg-field">
            <label>Durée d&apos;exclusion (minutes)</label>
            <input type="text" inputMode="numeric" value={d.timeout_minutes} onChange={(e) => mod.patch({ timeout_minutes: num(e.target.value) })} />
          </div>
        )}
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.auto_verrou} onChange={(e) => mod.patch({ auto_verrou: e.target.checked })} />
          <span className="switch" />
          <span>Verrouiller automatiquement le serveur</span>
        </label>
        {d.auto_verrou && (
          <div className="cfg-field">
            <label>Levée automatique après (minutes, 0 = manuelle)</label>
            <input type="text" inputMode="numeric" value={d.verrou_duree_min} onChange={(e) => mod.patch({ verrou_duree_min: num(e.target.value) })} />
          </div>
        )}

        <h3>Anti-flood</h3>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.flood_actif} onChange={(e) => mod.patch({ flood_actif: e.target.checked })} />
          <span className="switch" />
          <span>Exclure les membres qui floodent ou mentionnent en masse (modérateurs exemptés)</span>
        </label>
        {d.flood_actif && (
          <>
            <div className="field-2col">
              <div className="cfg-field">
                <label>Messages max</label>
                <input type="text" inputMode="numeric" value={d.flood_messages} onChange={(e) => mod.patch({ flood_messages: num(e.target.value) })} />
              </div>
              <div className="cfg-field">
                <label>…en (secondes)</label>
                <input type="text" inputMode="numeric" value={d.flood_fenetre_s} onChange={(e) => mod.patch({ flood_fenetre_s: num(e.target.value) })} />
              </div>
            </div>
            <div className="field-2col">
              <div className="cfg-field">
                <label>Mentions max dans un message</label>
                <input type="text" inputMode="numeric" value={d.mentions_seuil} onChange={(e) => mod.patch({ mentions_seuil: num(e.target.value) })} />
              </div>
              <div className="cfg-field">
                <label>Exclusion (minutes)</label>
                <input type="text" inputMode="numeric" value={d.flood_timeout_min} onChange={(e) => mod.patch({ flood_timeout_min: num(e.target.value) })} />
              </div>
            </div>
            <p className="cfg-hint">Le message fautif est supprimé. Le texte des messages n&apos;est jamais lu : seuls le rythme et les mentions comptent.</p>
          </>
        )}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Dernières alertes</h2>
          <p>Depuis le dernier redémarrage du bot.</p>
        </div>
        {!etat || etat.alertes.length === 0 ? (
          <Parchemin icone="bouclier" titre="Rien à signaler">La garde veille ; ses alertes s&apos;afficheront ici.</Parchemin>
        ) : (
          <div className="game-list">
            {etat.alertes.map((a) => (
              <div className="game-row" key={a.quand + a.titre}>
                <span className="game-label">
                  <b>{a.titre}</b> — {a.texte.replace(/<[@#&]*\d+>/g, "…").replace(/\*\*/g, "").split("\n")[0]}
                </span>
                <span className="game-cat">{depuis(a.quand)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

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
