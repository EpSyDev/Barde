"use client";

// Journal : le fil de ce qui s'est passé sur le serveur, et le réglage de ce qu'on
// garde. Deux limites assumées, écrites à l'écran plutôt que découvertes plus tard :
// le contenu des messages supprimés n'est jamais enregistré (le bot ne demande pas
// l'intent qui le permettrait), et le journal ne remonte pas au-delà de la rétention.

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useToasts } from "@/components/Toasts";
import { runAction, useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { DirtyBar, Loading, Vide, depuis, dateCourte } from "@/components/ui";

type Channel = { id: string; name: string; category: string | null };

type Cfg = {
  enabled: boolean;
  channel_id: string | null;
  retention_jours: number;
  events: Record<string, boolean>;
  miroir: Record<string, boolean>;
};

type Evenement = {
  id: number; ts: string; kind: string; kind_label: string;
  actor_tag: string; target_id: string | null; target_tag: string;
  summary: string; detail: Record<string, unknown> | null;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon miroir",
  retention_jours: "Durée de conservation",
  events: "Événements enregistrés",
  miroir: "Événements publiés sur Discord",
};

export default function Journal({ aller }: { aller: (id: string, membre?: string) => void }) {
  const cfg = useModuleConfig<Cfg>("journal", (raw) => ({
    enabled: !!raw.enabled,
    channel_id: raw.channel_id != null ? String(raw.channel_id) : null,
    retention_jours: Number(raw.retention_jours ?? 30),
    events: (raw.events || {}) as Record<string, boolean>,
    miroir: (raw.miroir || {}) as Record<string, boolean>,
  }));
  useUnsavedGuard(cfg.dirty);

  const [onglet, setOnglet] = useState<"flux" | "reglages">("flux");
  const [events, setEvents] = useState<Evenement[]>([]);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState("");
  const [fin, setFin] = useState(false);
  const [chargeEnCours, setChargeEnCours] = useState(false);
  const toasts = useToasts();

  const charger = useCallback(async (avant?: number) => {
    setChargeEnCours(true);
    try {
      const data = await runAction<{ events: Evenement[]; kinds: Record<string, string> }>(
        "journal", "flux", { limit: 60, kind: filtre || undefined, before_id: avant }
      );
      setKinds(data.kinds || {});
      setEvents((prev) => (avant ? [...prev, ...(data.events || [])] : data.events || []));
      setFin((data.events || []).length < 60);
    } catch {
      setEvents([]);
    } finally {
      setChargeEnCours(false);
    }
  }, [filtre]);

  useEffect(() => {
    charger();
  }, [charger]);

  const purger = async () => {
    const saisie = window.prompt(
      "Supprimer les événements plus vieux que combien de jours ?", "30"
    );
    if (saisie === null) return;
    const jours = Number(saisie);
    if (!Number.isFinite(jours) || jours <= 0) return toasts.err("Durée invalide");
    try {
      const res = await runAction<{ supprimes: number }>("journal", "purger", { jours });
      toasts.ok("Journal allégé", `${res.supprimes} événement(s) supprimé(s).`);
      charger();
    } catch (e) {
      toasts.err("Échec", (e as Error).message);
    }
  };

  if (cfg.loading) return <Loading lignes={6} />;
  if (cfg.error && !cfg.draft) return <Vide>{cfg.error}</Vide>;
  const d = cfg.draft!;

  return (
    <>
      <div className="tabs">
        <button
          className={`tab ${onglet === "flux" ? "active" : ""}`}
          onClick={() => setOnglet("flux")}
        >
          Le fil
        </button>
        <button
          className={`tab ${onglet === "reglages" ? "active" : ""}`}
          onClick={() => setOnglet("reglages")}
        >
          Ce qu&apos;on garde
        </button>
      </div>

      {onglet === "flux" ? (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <button
              className={`btn small ${filtre === "" ? "on" : "ghost"}`}
              onClick={() => setFiltre("")}
            >
              Tout
            </button>
            {Object.entries(kinds).map(([k, label]) => (
              <button
                key={k}
                className={`btn small ${filtre === k ? "on" : "ghost"}`}
                onClick={() => setFiltre(k)}
              >
                {label}
              </button>
            ))}
            <div className="spacer" />
            <button className="btn small ghost" onClick={purger}>
              <Icon name="corbeille" /> Purger
            </button>
          </div>

          <section className="cfg-card">
            {events.length ? (
              <>
                <div className="timeline">
                  {events.map((e) => (
                    <div className="tl-row" key={e.id}>
                      <div className="tl-head">
                        <span className="tl-kind">{e.kind_label}</span>
                        <span className="tl-time" title={dateCourte(e.ts)}>{depuis(e.ts)}</span>
                      </div>
                      <div className="tl-body">
                        {e.summary}
                        {e.target_id && (
                          <>
                            {" "}
                            <button className="link" onClick={() => aller("membres", e.target_id!)}>
                              fiche
                            </button>
                          </>
                        )}
                      </div>
                      {(e.actor_tag || e.detail) && (
                        <div className="tl-detail">
                          {e.actor_tag && `par ${e.actor_tag}`}
                          {e.actor_tag && e.detail && " · "}
                          {e.detail &&
                            Object.entries(e.detail)
                              .map(([k, v]) => `${k} : ${v}`)
                              .join(" · ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {!fin && (
                  <div className="row end" style={{ marginTop: 16 }}>
                    <button
                      className="btn"
                      disabled={chargeEnCours}
                      onClick={() => charger(events.at(-1)?.id)}
                    >
                      {chargeEnCours ? "Chargement…" : "Voir plus loin"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">
                {d.enabled
                  ? "Rien de journalisé pour l'instant — le journal ne remonte pas avant sa mise en service."
                  : "Le journal est éteint : rien n'est enregistré."}
              </p>
            )}
          </section>
        </>
      ) : (
        <ReglagesJournal cfg={cfg} kinds={kinds} />
      )}

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

function ReglagesJournal({
  cfg,
  kinds,
}: {
  cfg: ReturnType<typeof useModuleConfig<Cfg>>;
  kinds: Record<string, string>;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const d = cfg.draft!;

  useEffect(() => {
    fetch("/api/fripouille/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((data) => setChannels(data.channels || []))
      .catch(() => setChannels([]));
  }, []);

  // Si le flux n'a pas encore répondu, on part des familles déjà présentes en config.
  const familles = Object.keys(kinds).length
    ? kinds
    : Object.fromEntries(Object.keys(d.events).map((k) => [k, k]));

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="registre" /></span>
          <div>
            <h2>Conservation</h2>
            <p>
              La VM a un petit disque : on garde une fenêtre, pas l&apos;histoire
              complète du serveur. La purge tourne au fil de l&apos;eau.
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
          <span>Enregistrer les événements</span>
        </label>

        <div className="cfg-field">
          <label htmlFor="j-ret">Conserver pendant (jours)</label>
          <input
            id="j-ret"
            type="number"
            min={1}
            max={365}
            value={d.retention_jours}
            onChange={(e) => cfg.patch({ retention_jours: Number(e.target.value) })}
          />
        </div>

        <div className="cfg-field">
          <label htmlFor="j-ch">Salon miroir</label>
          <select
            id="j-ch"
            value={d.channel_id || ""}
            onChange={(e) => cfg.patch({ channel_id: e.target.value || null })}
          >
            <option value="">— aucun —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.category ? `${c.category} / ` : ""}#{c.name}
              </option>
            ))}
          </select>
          <span className="hint">
            Les familles cochées « publier » y sont postées en embed, en plus d&apos;être
            enregistrées.
          </span>
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="oeil" /></span>
          <div>
            <h2>Familles d&apos;événements</h2>
            <p>
              Décocher « garder » réduit le bruit et les écritures. Le contenu des
              messages supprimés n&apos;est jamais enregistré, quelle que soit la case.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Famille</th>
                <th className="num">Garder</th>
                <th className="num">Publier</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(familles).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td className="num">
                    <label className="cfg-toggle compact" style={{ justifyContent: "flex-end" }}>
                      <input
                        type="checkbox"
                        checked={d.events[k] !== false}
                        onChange={(e) => cfg.patch({ events: { ...d.events, [k]: e.target.checked } })}
                      />
                      <span className="switch" />
                    </label>
                  </td>
                  <td className="num">
                    <label className="cfg-toggle compact" style={{ justifyContent: "flex-end" }}>
                      <input
                        type="checkbox"
                        checked={!!d.miroir[k]}
                        disabled={d.events[k] === false || !d.channel_id}
                        onChange={(e) => cfg.patch({ miroir: { ...d.miroir, [k]: e.target.checked } })}
                      />
                      <span className="switch" />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
