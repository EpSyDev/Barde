"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide, depuis } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";

type Cfg = {
  enabled: boolean;
  channel_id: string | null;
  delai_s: number;
  reprise_min: number;
  ping_role_jeu: boolean;
  ping_cooldown_min: number;
  optout_role_id: string | null;
  ignores: string;
};
type Partie = { nom: string; joueurs: string[]; debut: string; terminee: boolean };
type Etat = { presences: boolean; parties: Partie[] };

const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon",
  delai_s: "Délai avant annonce",
  reprise_min: "Délai de reprise",
  ping_role_jeu: "Ping du rôle-jeu",
  ping_cooldown_min: "Intervalle entre pings",
  optout_role_id: "Rôle « discret »",
  ignores: "Activités ignorées",
};

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  delai_s: Number(d.delai_s ?? 120),
  reprise_min: Number(d.reprise_min ?? 30),
  ping_role_jeu: !!d.ping_role_jeu,
  ping_cooldown_min: Number(d.ping_cooldown_min ?? 120),
  optout_role_id: d.optout_role_id != null ? String(d.optout_role_id) : null,
  ignores: Array.isArray(d.ignores) ? (d.ignores as string[]).join("\n") : "",
});

const serialize = (c: Cfg) => ({
  ...c,
  delai_s: Math.max(0, Math.round(c.delai_s) || 0),
  reprise_min: Math.max(1, Math.round(c.reprise_min) || 1),
  ping_cooldown_min: Math.max(0, Math.round(c.ping_cooldown_min) || 0),
  ignores: c.ignores.split("\n").map((s) => s.trim()).filter(Boolean),
});

/** Annonces « X vient de lancer Red Dead » dans le salon « Qui est en ligne ». */
export default function EnLigne() {
  const mod = useModuleConfig<Cfg>("enligne", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const [etat, setEtat] = useState<Etat | null>(null);

  const chargerEtat = useCallback(async () => {
    try {
      const r = await fetch("/api/fripouille/action/enligne/etat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) setEtat(await r.json());
    } catch {
      /* silencieux : le panneau reste utilisable */
    }
  }, []);
  useEffect(() => {
    chargerEtat();
    const t = setInterval(chargerEtat, 30000);
    return () => clearInterval(t);
  }, [chargerEtat]);

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  const enCours = etat?.parties.filter((p) => !p.terminee) || [];

  return (
    <div className="cfg-grid wide">
      {etat && !etat.presences && (
        <div className="edit-banner">
          ⚠️ L&apos;intent « Presence » n&apos;est pas actif : le bot ne voit pas encore les jeux lancés.
          Coche « Presence Intent » sur le portail développeur Discord (app La Fripouille), puis ajoute
          <code> FRIPOUILLE_PRESENCES=1 </code> au .env de la VM et redémarre le bot.
        </div>
      )}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="eclair" />
          </span>
          <div>
            <h2>Qui est en ligne</h2>
            <p>
              Quand un membre lance un jeu, une carte « 🎮 Red Dead Redemption 2 — En jeu : X » apparaît
              dans le salon. Une seule carte par jeu : les suivants s&apos;y ajoutent. Le bouton
              « 🙋 Je suis chaud » pinge les joueurs en cours pour les rejoindre.
            </p>
          </div>
        </div>

        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Annoncer les jeux lancés</span>
        </label>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon des annonces</label>
            <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle « discret » (jamais annoncé)</label>
            <select
              value={d.optout_role_id ?? ""}
              onChange={(e) => mod.patch({ optout_role_id: e.target.value || null })}
            >
              <option value="">— Aucun —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-2col">
          <div className="cfg-field">
            <label>Délai avant annonce (secondes)</label>
            <input type="text" inputMode="numeric" value={d.delai_s} onChange={(e) => mod.patch({ delai_s: num(e.target.value) })} />
            <p className="cfg-hint">Le jeu doit tourner depuis ce délai : évite les lancements éclairs et les crashs.</p>
          </div>
          <div className="cfg-field">
            <label>Délai de reprise (minutes)</label>
            <input type="text" inputMode="numeric" value={d.reprise_min} onChange={(e) => mod.patch({ reprise_min: num(e.target.value) })} />
            <p className="cfg-hint">Si quelqu&apos;un relance dans ce délai, la carte terminée reprend vie au lieu d&apos;en poster une nouvelle.</p>
          </div>
        </div>

        <label className="cfg-toggle">
          <input type="checkbox" checked={d.ping_role_jeu} onChange={(e) => mod.patch({ ping_role_jeu: e.target.checked })} />
          <span className="switch" />
          <span>Pinger le rôle-jeu correspondant à la première annonce</span>
        </label>
        {d.ping_role_jeu && (
          <div className="cfg-field">
            <label>Au plus un ping par rôle toutes les (minutes)</label>
            <input
              type="text"
              inputMode="numeric"
              value={d.ping_cooldown_min}
              onChange={(e) => mod.patch({ ping_cooldown_min: num(e.target.value) })}
            />
            <p className="cfg-hint">
              Le jeu est relié au rôle dont le nom correspond dans Rôles-jeux (« Red Dead » ↔ « Red Dead
              Redemption 2 »). Seuls ceux qui ont pris ce rôle sont notifiés.
            </p>
          </div>
        )}

        <div className="cfg-field">
          <label>Activités ignorées (une par ligne)</label>
          <textarea rows={5} value={d.ignores} onChange={(e) => mod.patch({ ignores: e.target.value })} />
          <p className="cfg-hint">Applis qui se déclarent « en jeu » sans en être un (lanceurs, éditeurs, outils).</p>
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>🎮 Parties en cours</h2>
          <p>Ce que le bot suit en ce moment (rafraîchi toutes les 30 s).</p>
        </div>
        {enCours.length === 0 ? (
          <p className="cfg-hint">Personne en jeu pour l&apos;instant.</p>
        ) : (
          <div className="game-list">
            {enCours.map((p) => (
              <div className="game-row" key={p.nom}>
                <span className="game-label">
                  <b>{p.nom}</b> — {p.joueurs.join(", ")}
                </span>
                <span className="game-cat">{depuis(p.debut)}</span>
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
