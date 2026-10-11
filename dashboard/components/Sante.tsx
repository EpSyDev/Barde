"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide, depuis } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";
import Parchemin from "@/components/Parchemin";

type Cfg = {
  enabled: boolean; channel_id: string | null; role_id: string | null;
  seuil_ram_mo: number; seuil_swap_pct: number; seuil_cpu_pct: number; seuil_disque_pct: number;
};
type Mesure = {
  t: string; ram_totale_mo: number; ram_dispo_mo: number; swap_mo: number; swap_pct: number;
  cpu_pct: number | null; disque_pct: number; disque_libre_go: number;
};
type Service = { actif: boolean; etat: string; memoire_mo: number | null; redemarrages: number | null };
type EtatSante = { actuel: Mesure | null; historique: Mesure[]; services: Record<string, Service>; en_alerte: string[] };
type Derniere = { date?: string; ok?: boolean; taille?: number; duree_s?: number; erreur?: string | null; objets?: string[]; par?: string };
type EtatSauv = { par_configure: boolean; derniere: Derniere; sources: string[]; locale: { taille: number; date: string } | null };
type CfgSauv = { enabled: boolean; heure: string };

const LABELS: Record<string, string> = {
  enabled: "Alertes", channel_id: "Salon d'alerte", role_id: "Rôle pingé", seuil_ram_mo: "Seuil RAM",
  seuil_swap_pct: "Seuil swap", seuil_cpu_pct: "Seuil CPU", seuil_disque_pct: "Seuil disque",
};
const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  role_id: d.role_id != null ? String(d.role_id) : null,
  seuil_ram_mo: Number(d.seuil_ram_mo ?? 80),
  seuil_swap_pct: Number(d.seuil_swap_pct ?? 85),
  seuil_cpu_pct: Number(d.seuil_cpu_pct ?? 90),
  seuil_disque_pct: Number(d.seuil_disque_pct ?? 90),
});
const serialize = (c: Cfg) => c;
const normSauv = (d: Record<string, unknown>): CfgSauv => ({
  enabled: !!d.enabled,
  heure: typeof d.heure === "string" && /^\d{2}:\d{2}$/.test(d.heure) ? d.heure : "04:30",
});

async function action(mod: string, nom: string) {
  const r = await fetch(`/api/fripouille/action/${mod}/${nom}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

const mo = (o: number) => (o >= 1e6 ? `${(o / 1e6).toFixed(1)} Mo` : `${Math.round(o / 1e3)} ko`);

/** Courbe SVG minimaliste (24 h). */
function Courbe({ valeurs, max, couleur }: { valeurs: number[]; max: number; couleur: string }) {
  if (valeurs.length < 2) return <p className="cfg-hint">Courbe disponible après quelques minutes de mesures.</p>;
  const h = 50, l = 300;
  const pts = valeurs.map((v, i) => `${(i / (valeurs.length - 1)) * l},${h - (Math.min(v, max) / max) * (h - 2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${l} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }}>
      <polyline points={pts} fill="none" stroke={couleur} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Santé de la VM (mesures réelles, alertes) et sauvegarde nocturne vers Oracle. */
export default function Sante() {
  const mod = useModuleConfig<Cfg>("sante", normalize, serialize);
  const sauv = useModuleConfig<CfgSauv>("sauvegarde", normSauv, (c) => c);
  useUnsavedGuard(mod.dirty || sauv.dirty);
  const { roles, channels } = useGuildRefs();
  const [etat, setEtat] = useState<EtatSante | null>(null);
  const [es, setEs] = useState<EtatSauv | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setEtat(await action("sante", "etat"));
      setEs(await action("sauvegarde", "etat"));
    } catch {
      /* silencieux */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000);
    return () => clearInterval(t);
  }, [charger]);

  if (mod.loading || sauv.loading) return <Loading lignes={5} />;
  const d = mod.draft, s = sauv.draft;
  if (!d || !s) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  const a = etat?.actuel;
  const h = etat?.historique || [];
  const der = es?.derniere || {};

  const sauvegarderMaintenant = async () => {
    setOccupe(true);
    setNote(null);
    try {
      const j = await action("sauvegarde", "lancer");
      setNote(`✅ Sauvegarde envoyée (${mo(j.derniere.taille)}, ${j.derniere.duree_s} s).`);
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
      charger();
    }
  };

  return (
    <div className="cfg-grid wide">
      {etat && etat.en_alerte.length > 0 && <div className="edit-banner">🚨 En alerte : {etat.en_alerte.join(", ")}</div>}
      {es && !es.par_configure && (
        <div className="edit-banner">
          ⚠️ Sauvegarde vers Oracle non configurée : l&apos;archive reste sur la VM. Ajoute <code>FRIPOUILLE_SAUVEGARDE_PAR</code> au .env (voir la procédure).
        </div>
      )}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="engrenage" /></span>
          <div>
            <h2>La VM en ce moment</h2>
            <p>Mesures relevées chaque minute sur la VM ; courbes sur les dernières 24 h.</p>
          </div>
        </div>
        {!a ? (
          <Parchemin icone="coeur" titre="Pas encore de mesure">La première arrive une minute après le démarrage du bot.</Parchemin>
        ) : (
          <>
            <div className="game-list">
              <div className="game-row"><span className="game-label">RAM disponible</span><span className="game-cat">{a.ram_dispo_mo} / {a.ram_totale_mo} Mo</span></div>
              <Courbe valeurs={h.map((x) => a.ram_totale_mo - x.ram_dispo_mo)} max={a.ram_totale_mo} couleur="var(--gold)" />
              <div className="game-row"><span className="game-label">Swap utilisé</span><span className="game-cat">{a.swap_mo} Mo ({a.swap_pct} %)</span></div>
              <div className="game-row"><span className="game-label">CPU</span><span className="game-cat">{a.cpu_pct ?? "—"} %</span></div>
              <Courbe valeurs={h.map((x) => x.cpu_pct ?? 0)} max={100} couleur="var(--ember)" />
              <div className="game-row"><span className="game-label">Disque</span><span className="game-cat">{a.disque_pct} % · {a.disque_libre_go} Go libres</span></div>
            </div>
            <h3>Services</h3>
            <div className="game-list">
              {Object.entries(etat?.services || {}).map(([nom, sv]) => (
                <div className="game-row" key={nom}>
                  <span className="game-label">{sv.actif ? "🟢" : "🔴"} <b>{nom}</b> {sv.actif ? "" : `— ${sv.etat}`}</span>
                  <span className="game-cat">{sv.memoire_mo != null ? `${sv.memoire_mo} Mo` : "—"}{sv.redemarrages ? ` · ${sv.redemarrages} redémarrage(s) auto` : ""}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Sauvegarde des données</h2>
          <p>
            Chaque nuit, une archive des données part sur Oracle Object Storage (7 dernières nuits + 5 dernières semaines). La
            musique (media/) et les tokens (.env) n&apos;y sont jamais inclus.
          </p>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={s.enabled} onChange={(e) => sauv.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Sauvegarder chaque nuit</span>
        </label>
        <div className="cfg-field">
          <label>Heure (Paris)</label>
          <input type="time" value={s.heure} onChange={(e) => sauv.patch({ heure: e.target.value || "04:30" })} />
        </div>
        <div className="game-list">
          <div className="game-row">
            <span className="game-label">Dernière sauvegarde</span>
            <span className="game-cat">
              {der.date ? `${der.ok ? "✅" : "⚠️"} ${depuis(der.date)}${der.taille ? ` · ${mo(der.taille)}` : ""}${der.duree_s ? ` · ${der.duree_s} s` : ""}` : "jamais"}
            </span>
          </div>
          {der.erreur && <p className="cfg-hint">⚠️ {der.erreur}</p>}
          {der.objets && der.objets.length > 0 && <p className="cfg-hint">Envoyée sous : {der.objets.join(", ")}</p>}
          {es?.locale && <div className="game-row"><span className="game-label">Copie sur la VM</span><span className="game-cat">{mo(es.locale.taille)} · {depuis(es.locale.date)}</span></div>}
          {es && <p className="cfg-hint">Contenu : {es.sources.join(", ")}</p>}
        </div>
        <button className="btn primary" type="button" disabled={occupe} onClick={sauvegarderMaintenant}>
          {occupe ? "Sauvegarde en cours…" : "💾 Sauvegarder maintenant"}
        </button>
        {note && <p className="cfg-hint">{note}</p>}
        {sauv.dirty && <button className="btn" type="button" onClick={sauv.save} disabled={sauv.saving}>Enregistrer le réglage de sauvegarde</button>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Alertes</h2>
          <p>Un seuil dépassé 5 minutes d&apos;affilée (ou un service arrêté) envoie une alerte, au plus une par heure et par sujet. Le retour à la normale est signalé.</p>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer les alertes</span>
        </label>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon (vide = salon d&apos;alerte de la Garde)</label>
            <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle pingé</label>
            <select value={d.role_id ?? ""} onChange={(e) => mod.patch({ role_id: e.target.value || null })}>
              <option value="">— Aucun —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field-2col">
          <div className="cfg-field"><label>RAM disponible minimale (Mo)</label><input type="text" inputMode="numeric" value={d.seuil_ram_mo} onChange={(e) => mod.patch({ seuil_ram_mo: num(e.target.value) })} /></div>
          <div className="cfg-field"><label>Swap maximal (%)</label><input type="text" inputMode="numeric" value={d.seuil_swap_pct} onChange={(e) => mod.patch({ seuil_swap_pct: num(e.target.value) })} /></div>
        </div>
        <div className="field-2col">
          <div className="cfg-field"><label>CPU maximal (%)</label><input type="text" inputMode="numeric" value={d.seuil_cpu_pct} onChange={(e) => mod.patch({ seuil_cpu_pct: num(e.target.value) })} /></div>
          <div className="cfg-field"><label>Disque maximal (%)</label><input type="text" inputMode="numeric" value={d.seuil_disque_pct} onChange={(e) => mod.patch({ seuil_disque_pct: num(e.target.value) })} /></div>
        </div>
        <button className="btn ghost" type="button" onClick={() => action("sante", "tester").then(() => setNote("✅ Alerte de test envoyée."), (e) => setNote(`⚠️ ${e.message}`))}>
          Tester l&apos;alerte
        </button>
      </section>

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
