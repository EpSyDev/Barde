"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";

type Cfg = { enabled: boolean; channel_id: string | null; ping_role_id: string | null; rappel_min: number };
type Soiree = {
  id: string;
  titre: string;
  jeu: string;
  description: string;
  debut: string;
  max: number;
  statut: "a_venir" | "terminee" | "annulee";
  inscrits_noms: string[];
  peut_etre_noms: string[];
};

const LABELS: Record<string, string> = {
  enabled: "Activation",
  channel_id: "Salon d'annonce",
  ping_role_id: "Rôle pingé",
  rappel_min: "Rappel avant le début",
};

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  ping_role_id: d.ping_role_id != null ? String(d.ping_role_id) : null,
  rappel_min: Number(d.rappel_min ?? 15),
});
const serialize = (c: Cfg) => ({ ...c, rappel_min: Math.max(1, Math.round(c.rappel_min) || 1) });

async function action(nom: string, payload: object = {}) {
  const r = await fetch(`/api/fripouille/action/soirees/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

const quand = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Soirées jeu : création depuis le dashboard, carte d'inscription sur Discord, rappel auto. */
export default function Soirees() {
  const mod = useModuleConfig<Cfg>("soirees", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const [liste, setListe] = useState<Soiree[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [f, setF] = useState({ titre: "", jeu: "", description: "", quand: "", max: 0, ping: true });

  const charger = useCallback(async () => {
    try {
      setListe((await action("liste")).soirees || []);
    } catch {
      /* silencieux */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 20000);
    return () => clearInterval(t);
  }, [charger]);

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const creer = async () => {
    setOccupe(true);
    setNote(null);
    try {
      await action("creer", {
        titre: f.titre,
        jeu: f.jeu,
        description: f.description,
        debut: new Date(f.quand).toISOString(),
        max: f.max,
        ping: f.ping,
      });
      setNote("✅ Soirée annoncée sur Discord.");
      setF({ titre: "", jeu: "", description: "", quand: "", max: 0, ping: true });
      await charger();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
    }
  };
  const agir = async (nom: "annuler" | "supprimer", s: Soiree, q: string) => {
    if (!window.confirm(q)) return;
    try {
      await action(nom, { id: s.id });
      await charger();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    }
  };

  const prochaines = liste.filter((s) => s.statut === "a_venir").sort((a, b) => a.debut.localeCompare(b.debut));
  const passees = liste.filter((s) => s.statut !== "a_venir");
  const prete = f.titre.trim() && f.quand && !Number.isNaN(new Date(f.quand).getTime()) && d.channel_id;

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="cor" />
          </span>
          <div>
            <h2>Nouvelle soirée</h2>
            <p>
              Une carte avec boutons d&apos;inscription est postée dans le salon d&apos;annonce ; les inscrits sont
              prévenus quelques minutes avant le début.
            </p>
          </div>
        </div>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Titre</label>
            <input type="text" maxLength={100} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder="Ex. Soirée Red Dead en ligne" />
          </div>
          <div className="cfg-field">
            <label>Jeu</label>
            <input type="text" maxLength={100} value={f.jeu} onChange={(e) => setF({ ...f, jeu: e.target.value })} />
          </div>
        </div>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Date et heure</label>
            <input type="datetime-local" value={f.quand} onChange={(e) => setF({ ...f, quand: e.target.value })} />
          </div>
          <div className="cfg-field">
            <label>Places (0 = illimité)</label>
            <input type="text" inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </div>
        </div>
        <div className="cfg-field">
          <label>Description</label>
          <textarea rows={3} maxLength={1500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={f.ping} onChange={(e) => setF({ ...f, ping: e.target.checked })} />
          <span className="switch" />
          <span>Pinger le rôle d&apos;annonce</span>
        </label>
        <button className="btn primary" type="button" disabled={occupe || !prete} onClick={creer}>
          {occupe ? "…" : "📣 Annoncer la soirée"}
        </button>
        {!d.channel_id && <p className="cfg-hint">⚠️ Choisis d&apos;abord le salon d&apos;annonce ci-dessous (et enregistre).</p>}
        {note && <p className="cfg-hint">{note}</p>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>À venir</h2>
        </div>
        {prochaines.length === 0 ? (
          <p className="cfg-hint">Aucune soirée prévue.</p>
        ) : (
          <div className="game-list">
            {prochaines.map((s) => (
              <div className="game-row" key={s.id} style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="game-label">
                  <b>{s.titre}</b>
                  {s.jeu ? ` · ${s.jeu}` : ""} — {quand(s.debut)}
                  <br />
                  ✅ {s.inscrits_noms.length}
                  {s.max ? ` / ${s.max}` : ""} {s.inscrits_noms.length ? `(${s.inscrits_noms.join(", ")})` : ""}
                  {s.peut_etre_noms.length ? ` · 🤔 ${s.peut_etre_noms.join(", ")}` : ""}
                </span>
                <button className="btn small danger" type="button" onClick={() => agir("annuler", s, `Annuler « ${s.titre} » ? Les inscrits seront prévenus.`)}>
                  Annuler
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {passees.length > 0 && (
        <section className="cfg-card">
          <div className="cfg-card-head">
            <h2>Passées</h2>
          </div>
          <div className="game-list">
            {passees.map((s) => (
              <div className="game-row" key={s.id} style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="game-label">
                  {s.statut === "annulee" ? "❌" : "🏁"} <b>{s.titre}</b> — {quand(s.debut)} · {s.inscrits_noms.length} inscrit(s)
                </span>
                <button className="btn icon danger" type="button" aria-label="Supprimer" onClick={() => agir("supprimer", s, `Supprimer « ${s.titre} » et sa carte Discord ?`)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Réglages</h2>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer les soirées</span>
        </label>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon d&apos;annonce</label>
            <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle pingé à l&apos;annonce</label>
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
          <label>Rappel aux inscrits (minutes avant le début)</label>
          <input type="text" inputMode="numeric" value={d.rappel_min} onChange={(e) => mod.patch({ rappel_min: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
      </section>

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
