"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";

type VoiceChannel = { id: string; name: string; category: string | null };
type Category = { id: string; name: string };
type VoiceCfg = {
  enabled: boolean;
  hub_channel_id: string | null;
  category_id: string | null;
  name_template: string;
  user_limit: number;
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  hub_channel_id: "Salon hub",
  category_id: "Catégorie des salons créés",
  name_template: "Nom du salon créé",
  user_limit: "Limite de places",
};

export default function Voice() {
  const cfg = useModuleConfig<VoiceCfg>("tempvoice", (d) => ({
    enabled: !!d.enabled,
    hub_channel_id: d.hub_channel_id != null ? String(d.hub_channel_id) : null,
    category_id: d.category_id != null ? String(d.category_id) : null,
    name_template: String(d.name_template || "Salon de {name}"),
    user_limit: Number(d.user_limit) || 0,
  }));
  useUnsavedGuard(cfg.dirty);

  const [channels, setChannels] = useState<VoiceChannel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/fripouille/voice-channels", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { channels: [] })),
      fetch("/api/fripouille/categories", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { categories: [] })),
    ])
      .then(([ch, cat]) => {
        setChannels(ch.channels || []);
        setCategories(cat.categories || []);
      })
      .catch(() => undefined);
  }, []);

  if (cfg.loading) return <Loading lignes={5} />;
  if (!cfg.draft) return <Vide>{cfg.error || "La Fripouille est injoignable."}</Vide>;
  const d = cfg.draft;

  return (
    <>
      <div className="cfg-grid wide">
        <section className="cfg-card">
          <div className="cfg-card-head">
            <span className="cfg-card-icon"><Icon name="cor" /></span>
            <div>
              <h2>Salons vocaux temporaires</h2>
              <p>
                Un salon « hub » que les membres rejoignent pour se créer un salon vocal
                perso, supprimé automatiquement une fois vide.
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
            <span>Activer les salons temporaires</span>
          </label>

          <div className="field-2col">
            <div className="cfg-field">
              <label htmlFor="v-hub">Salon « hub » (à rejoindre pour créer)</label>
              <select
                id="v-hub"
                value={d.hub_channel_id ?? ""}
                onChange={(e) => cfg.patch({ hub_channel_id: e.target.value || null })}
              >
                <option value="">— Choisir un salon vocal —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.category ? ` (${c.category})` : ""}
                  </option>
                ))}
              </select>
              <p className="cfg-hint">
                Crée un salon vocal nommé p. ex. « ➕ Créer un salon » et choisis-le ici.
              </p>
              {d.enabled && !d.hub_channel_id && (
                <span className="hint danger-text">
                  Activé sans hub : aucun salon ne sera créé.
                </span>
              )}
            </div>
            <div className="cfg-field">
              <label htmlFor="v-cat">Catégorie des salons créés</label>
              <select
                id="v-cat"
                value={d.category_id ?? ""}
                onChange={(e) => cfg.patch({ category_id: e.target.value || null })}
              >
                <option value="">— Celle du hub par défaut —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-2col">
            <div className="cfg-field">
              <label htmlFor="v-nom">Nom du salon créé</label>
              <input
                id="v-nom"
                type="text"
                value={d.name_template}
                onChange={(e) => cfg.patch({ name_template: e.target.value })}
                placeholder="Salon de {name}"
              />
              <p className="cfg-hint">
                Variable : <code>{"{name}"}</code> = pseudo du membre.
              </p>
            </div>
            <div className="cfg-field">
              <label htmlFor="v-lim">Limite de places par défaut</label>
              <input
                id="v-lim"
                type="number"
                min={0}
                max={99}
                value={d.user_limit}
                onChange={(e) =>
                  cfg.patch({ user_limit: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })
                }
              />
              <p className="cfg-hint">0 = illimité. Le propriétaire peut l&apos;ajuster ensuite.</p>
            </div>
          </div>

          <p className="cfg-hint">
            Le créateur reçoit « Gérer le salon » sur son salon : il le renomme, change la
            limite de places ou le verrouille directement depuis Discord. La Fripouille doit
            avoir « Gérer les salons » et « Déplacer les membres », son rôle placé au-dessus
            dans la hiérarchie.
          </p>
        </section>
      </div>

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
