"use client";

import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";

type Cfg = { enabled: boolean; channel_id: string | null; log_channel_id: string | null };

const LABELS: Record<string, string> = { enabled: "Activation", channel_id: "Salon", log_channel_id: "Journal MJ" };

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  log_channel_id: d.log_channel_id != null ? String(d.log_channel_id) : null,
});
// panel_message_id reste géré par le bot : on ne renvoie que les réglages.
const serialize = (c: Cfg) => ({ enabled: c.enabled, channel_id: c.channel_id, log_channel_id: c.log_channel_id });

const SYNTAXE: [string, string][] = [
  ["1d20+5", "test, attaque, jet de sauvegarde"],
  ["1d8+2d6+3", "dégâts combinés (arme + attaque sournoise)"],
  ["4d6kh3", "garder les 3 meilleurs dés"],
  ["2d6r2", "relancer une fois les 1 et 2 (arme à deux mains)"],
  ["d100", "percentile, affiché dizaine + unité"],
];

/** Table de dés D&D : panneau à boutons dans le salon de jeu + commandes /d et /initiative. */
export default function Des() {
  const mod = useModuleConfig<Cfg>("des", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { channels } = useGuildRefs();

  if (mod.loading) return <Loading lignes={4} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="bouclier" />
          </span>
          <div>
            <h2>Table de dés</h2>
            <p>
              Un panneau épinglé dans le salon de jeu : un clic par dé (d4 → d100), jet libre et
              tableau d&apos;initiative. Avantage et désavantage restent gérés à l&apos;oral par le MJ.
            </p>
          </div>
        </div>

        <a className="btn primary" href="/table" style={{ alignSelf: "flex-start", marginBottom: 14 }}>
          🎲 Ouvrir la piste de dés 3D
        </a>
        <a className="btn primary" href="/table/plateau" style={{ alignSelf: "flex-start", marginBottom: 14 }}>
          🗺️ Ouvrir le plateau de jeu
        </a>

        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Publier le panneau</span>
        </label>

        <div className="cfg-field">
          <label>Salon de jeu</label>
          <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          <p className="cfg-hint">
            Les commandes <code>/d</code> et <code>/initiative</code> marchent partout, y compris dans le
            chat d&apos;un salon vocal pendant la partie.
          </p>
        </div>

        <div className="cfg-field">
          <label>Journal du MJ</label>
          <ChannelSelect
            channels={channels}
            value={d.log_channel_id}
            onChange={(v) => mod.patch({ log_channel_id: v })}
            placeholder="— Aucun journal —"
          />
          <p className="cfg-hint">
            Salon privé du MJ : chaque jet (secrets compris), relance, entrée d&apos;initiative, tour
            passé et fin de combat y est consigné, sans ping.
          </p>
          {d.log_channel_id && d.log_channel_id === d.channel_id && (
            <span className="cfg-err">Le journal doit être un autre salon que la table de jeu.</span>
          )}
        </div>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>📜 Mémo des règles</h2>
          <p>Ce que comprend le lanceur (bouton ✍️ Jet libre ou /d).</p>
        </div>
        <div className="game-list">
          {SYNTAXE.map(([code, sens]) => (
            <div className="game-row" key={code}>
              <code>{code}</code>
              <span className="game-label">{sens}</span>
            </div>
          ))}
        </div>
        <p className="cfg-hint">
          Options : <b>critique</b> (dés de dégâts doublés, pas le modificateur), <b>secret</b> (jet du MJ, visible
          de lui seul, avec un bouton « Révéler »). 20 naturel = réussite critique, 1 naturel = échec
          critique. Seul le lanceur peut relancer son jet (🔁).
        </p>
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
