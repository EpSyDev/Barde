"use client";

// Modération : la configuration du module (salon de logs, escalade, motifs) d'un côté,
// le registre des sanctions de l'autre. Les gestes individuels, eux, se font sur la
// fiche du membre — là où on a le contexte pour décider.

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { runAction, useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { DirtyBar, Loading, Vide, Stat, depuis, dateCourte, duree, formatNombre } from "@/components/ui";

type Channel = { id: string; name: string; category: string | null };
type Palier = { warns: number; action: string; minutes?: number };

type Cfg = {
  enabled: boolean;
  log_channel_id: string | null;
  warn_expire_jours: number;
  timeout_defaut_minutes: number;
  notifier_membre: boolean;
  raisons: string[];
  escalade: Palier[];
};

type Sanction = {
  id: number; user_id: string; user_tag: string; kind: string; reason: string;
  moderator: string; ts: string; expires_ts: string | null; active: boolean;
  lifted_by: string;
};

type Stats = {
  total: Record<string, number>;
  periode: Record<string, number>;
  jours: number;
  recidivistes: { user_id: string; user_tag: string; n: number }[];
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  log_channel_id: "Salon des sanctions",
  warn_expire_jours: "Expiration des avertissements",
  timeout_defaut_minutes: "Durée d'exclusion par défaut",
  notifier_membre: "Message privé au membre",
  raisons: "Motifs proposés",
  escalade: "Règles d'escalade",
};

const SANCTION_LABEL: Record<string, string> = {
  note: "Observation", warn: "Avertissement", timeout: "Exclusion",
  kick: "Expulsion", ban: "Bannissement", unban: "Levée",
};

export default function Moderation({ aller }: { aller: (id: string, membre?: string) => void }) {
  const cfg = useModuleConfig<Cfg>("moderation", (raw) => ({
    enabled: !!raw.enabled,
    log_channel_id: raw.log_channel_id != null ? String(raw.log_channel_id) : null,
    warn_expire_jours: Number(raw.warn_expire_jours ?? 90),
    timeout_defaut_minutes: Number(raw.timeout_defaut_minutes ?? 60),
    notifier_membre: !!raw.notifier_membre,
    raisons: Array.isArray(raw.raisons) ? (raw.raisons as string[]) : [],
    escalade: Array.isArray(raw.escalade) ? (raw.escalade as Palier[]) : [],
  }));
  useUnsavedGuard(cfg.dirty);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filtre, setFiltre] = useState<string>("");
  const [nouveauMotif, setNouveauMotif] = useState("");
  const toasts = useToasts();

  const chargerRegistre = useCallback(async () => {
    try {
      const [liste, st] = await Promise.all([
        runAction<{ sanctions: Sanction[] }>("moderation", "liste", { limit: 60, kind: filtre || undefined }),
        runAction<Stats>("moderation", "stats", { jours: 30 }),
      ]);
      setSanctions(liste.sanctions || []);
      setStats(st);
    } catch {
      /* le registre reste vide plutôt que faux */
    }
  }, [filtre]);

  useEffect(() => {
    fetch("/api/fripouille/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => setChannels(d.channels || []))
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    chargerRegistre();
  }, [chargerRegistre]);

  const lever = async (id: number) => {
    try {
      const res = await runAction<{ ok: boolean; error?: string }>("moderation", "lever", { id });
      if (!res.ok) return toasts.err("Levée impossible", res.error);
      toasts.ok("Sanction levée");
      chargerRegistre();
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  if (cfg.loading) return <Loading lignes={6} />;
  if (cfg.error && !cfg.draft) return <Vide>{cfg.error}</Vide>;
  const d = cfg.draft!;

  const majPalier = (i: number, patch: Partial<Palier>) =>
    cfg.patch({ escalade: d.escalade.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <>
      {stats && (
        <div className="stat-grid">
          <Stat
            icon="balance"
            label="Sanctions (30 j)"
            value={formatNombre(Object.values(stats.periode).reduce((a, b) => a + b, 0))}
            hint={
              Object.entries(stats.periode)
                .map(([k, v]) => `${v} ${SANCTION_LABEL[k]?.toLowerCase() || k}`)
                .join(" · ") || "aucune"
            }
          />
          <Stat
            icon="registre"
            label="Depuis toujours"
            value={formatNombre(Object.values(stats.total).reduce((a, b) => a + b, 0))}
            hint="tout l'historique du registre"
          />
          <Stat
            icon="personnes"
            label="Le plus sanctionné"
            value={stats.recidivistes[0] ? `${stats.recidivistes[0].n}` : "—"}
            hint={stats.recidivistes[0]?.user_tag || "personne pour l'instant"}
          />
        </div>
      )}

      <div className="cfg-grid wide">
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="bouclier" /></span>
            <div>
              <h2>Réglages généraux</h2>
              <p>
                Le module désactivé, les commandes <code>/avertir</code> et
                <code> /sanctions</code> refusent de servir — le dashboard, lui, agit
                toujours.
              </p>
            </div>
          </div>

          <label className="cfg-toggle">
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) => cfg.patch({ enabled: e.target.checked })}
            />
            <span className="switch" />
            <span>Activer la modération</span>
          </label>

          <label className="cfg-toggle">
            <input
              type="checkbox"
              checked={d.notifier_membre}
              onChange={(e) => cfg.patch({ notifier_membre: e.target.checked })}
            />
            <span className="switch" />
            <span>Prévenir le membre en message privé</span>
          </label>

          <div className="cfg-field">
            <label htmlFor="mod-log">Salon des sanctions</label>
            <select
              id="mod-log"
              value={d.log_channel_id || ""}
              onChange={(e) => cfg.patch({ log_channel_id: e.target.value || null })}
            >
              <option value="">— aucun (rien n&apos;est publié) —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category ? `${c.category} / ` : ""}#{c.name}
                </option>
              ))}
            </select>
            <span className="hint">
              Chaque sanction y est publiée avec son motif, son auteur et son numéro.
            </span>
          </div>

          <div className="field-2col">
            <div className="cfg-field">
              <label htmlFor="mod-exp">Un avertissement compte pendant</label>
              <input
                id="mod-exp"
                type="number"
                min={0}
                value={d.warn_expire_jours}
                onChange={(e) => cfg.patch({ warn_expire_jours: Number(e.target.value) })}
              />
              <span className="hint">
                En jours. Passé ce délai il reste au dossier mais ne déclenche plus
                d&apos;escalade. 0 = jamais d&apos;expiration.
              </span>
            </div>
            <div className="cfg-field">
              <label htmlFor="mod-to">Exclusion par défaut</label>
              <input
                id="mod-to"
                type="number"
                min={1}
                max={40320}
                value={d.timeout_defaut_minutes}
                onChange={(e) => cfg.patch({ timeout_defaut_minutes: Number(e.target.value) })}
              />
              <span className="hint">
                En minutes — {duree(d.timeout_defaut_minutes)}. Discord plafonne à 28 jours.
              </span>
            </div>
          </div>
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="eclair" /></span>
            <div>
              <h2>Escalade automatique</h2>
              <p>
                Au N-ième avertissement actif, le bot applique lui-même la suite. La
                règle se déclenche sur le compte exact, pas « au moins N ».
              </p>
            </div>
          </div>

          <div className="stack">
            {d.escalade.map((p, i) => (
              <div className="rec-item" key={i}>
                <div className="rec-head">
                  <span className="rec-freq">
                    au <input
                      type="number"
                      min={1}
                      value={p.warns}
                      style={{ width: 64 }}
                      onChange={(e) => majPalier(i, { warns: Number(e.target.value) })}
                    /> e avertissement
                  </span>
                  <select
                    value={p.action}
                    style={{ width: "auto" }}
                    onChange={(e) => majPalier(i, { action: e.target.value })}
                  >
                    <option value="timeout">exclure</option>
                    <option value="kick">expulser</option>
                    <option value="ban">bannir</option>
                  </select>
                  {p.action === "timeout" && (
                    <span className="rec-freq">
                      pendant <input
                        type="number"
                        min={1}
                        value={p.minutes ?? 60}
                        style={{ width: 84 }}
                        onChange={(e) => majPalier(i, { minutes: Number(e.target.value) })}
                      /> min
                      <span className="freq-value">({duree(p.minutes ?? 60)})</span>
                    </span>
                  )}
                  <button
                    className="btn icon danger"
                    style={{ marginLeft: "auto" }}
                    onClick={() => cfg.patch({ escalade: d.escalade.filter((_, j) => j !== i) })}
                    aria-label="Retirer ce palier"
                  >
                    <Icon name="corbeille" />
                  </button>
                </div>
              </div>
            ))}
            {!d.escalade.length && (
              <p className="muted">
                Aucune escalade : les avertissements s&apos;accumulent sans jamais rien
                déclencher.
              </p>
            )}
            <button
              className="btn"
              onClick={() =>
                cfg.patch({
                  escalade: [...d.escalade, { warns: (d.escalade.at(-1)?.warns || 0) + 1, action: "timeout", minutes: 60 }],
                })
              }
            >
              Ajouter un palier
            </button>
          </div>
        </section>

        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="plume" /></span>
            <div>
              <h2>Motifs courants</h2>
              <p>Proposés dans les menus pour éviter les motifs écrits à la va-vite.</p>
            </div>
          </div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {d.raisons.map((r, i) => (
              <span className="chip" key={`${r}-${i}`}>
                {r}
                <button
                  onClick={() => cfg.patch({ raisons: d.raisons.filter((_, j) => j !== i) })}
                  aria-label={`Retirer ${r}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {!d.raisons.length && <span className="muted">Aucun motif enregistré.</span>}
          </div>
          <div className="media-field">
            <input
              className="input"
              type="text"
              value={nouveauMotif}
              placeholder="Nouveau motif…"
              onChange={(e) => setNouveauMotif(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nouveauMotif.trim()) {
                  cfg.patch({ raisons: [...d.raisons, nouveauMotif.trim()] });
                  setNouveauMotif("");
                }
              }}
            />
            <button
              className="btn"
              disabled={!nouveauMotif.trim()}
              onClick={() => {
                cfg.patch({ raisons: [...d.raisons, nouveauMotif.trim()] });
                setNouveauMotif("");
              }}
            >
              Ajouter
            </button>
          </div>
        </section>
      </div>

      <section className="cfg-card" style={{ marginTop: 20 }}>
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="registre" /></span>
          <div>
            <h2>Registre des sanctions</h2>
            <p>Les 60 dernières, toutes portes d&apos;entrée confondues (Discord et dashboard).</p>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          {["", "warn", "timeout", "kick", "ban", "note"].map((k) => (
            <button
              key={k || "tous"}
              className={`btn small ${filtre === k ? "on" : "ghost"}`}
              onClick={() => setFiltre(k)}
            >
              {k ? SANCTION_LABEL[k] : "Tout"}
            </button>
          ))}
        </div>

        {sanctions.length ? (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Membre</th>
                  <th>Motif</th>
                  <th>Tavernier</th>
                  <th>Quand</th>
                  <th className="actions"></th>
                </tr>
              </thead>
              <tbody>
                {sanctions.map((s) => (
                  <tr key={s.id}>
                    <td className="muted mono">{s.id}</td>
                    <td>
                      <span className={`tag ${s.kind} ${s.active ? "" : "done"}`}>
                        {SANCTION_LABEL[s.kind] || s.kind}
                      </span>
                    </td>
                    <td>
                      <button className="link" onClick={() => aller("membres", s.user_id)}>
                        {s.user_tag || s.user_id}
                      </button>
                    </td>
                    <td>{s.reason || <em className="muted">sans motif</em>}</td>
                    <td className="muted">{s.moderator || "—"}</td>
                    <td className="muted nowrap" title={dateCourte(s.ts)}>{depuis(s.ts)}</td>
                    <td className="actions">
                      {s.active && s.kind !== "note" && (
                        <button className="btn small ghost" onClick={() => lever(s.id)}>
                          Lever
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucune sanction enregistrée avec ce filtre.</p>
        )}
      </section>

      <DirtyBar
        dirty={cfg.dirty}
        dirtyKeys={cfg.dirtyKeys}
        saving={cfg.saving}
        onSave={cfg.save}
        onReset={cfg.reset}
        labels={LABELS}
      />
    </>
  );
}
