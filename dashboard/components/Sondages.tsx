"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import { ChannelSelect, useGuildRefs } from "@/components/Mentions";
import Parchemin from "@/components/Parchemin";

type Cfg = { enabled: boolean; channel_id: string | null; ping_role_id: string | null };
type Option = { label: string; role_id: string };
type Sondage = {
  id: string; question: string; fin: string; statut: "ouvert" | "clos"; gagnant: string | null;
  soiree: { creer: boolean; debut?: string }; votants: number;
  options: { id: string; label: string; role_id: string; voix: number }[];
};
type JeuRole = { label: string; role_id: string; emoji: string };

const LABELS: Record<string, string> = { enabled: "Activation", channel_id: "Salon", ping_role_id: "Rôle pingé" };
const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  channel_id: d.channel_id != null ? String(d.channel_id) : null,
  ping_role_id: d.ping_role_id != null ? String(d.ping_role_id) : null,
});

async function action(nom: string, payload: object = {}) {
  const r = await fetch(`/api/fripouille/action/sondages/${nom}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

const quand = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** « À quoi on joue ce week-end ? » : vote à boutons, le gagnant devient une soirée. */
export default function Sondages() {
  const mod = useModuleConfig<Cfg>("sondages", normalize, (c) => c);
  useUnsavedGuard(mod.dirty);
  const { roles, channels } = useGuildRefs();
  const [jeux, setJeux] = useState<JeuRole[]>([]);
  const [liste, setListe] = useState<Sondage[]>([]);
  const [question, setQuestion] = useState("À quoi on joue ce week-end ?");
  const [options, setOptions] = useState<Option[]>([]);
  const [libre, setLibre] = useState("");
  const [fin, setFin] = useState("");
  const [creerSoiree, setCreerSoiree] = useState(true);
  const [debut, setDebut] = useState("");
  const [max, setMax] = useState(0);
  const [ping, setPing] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setListe((await action("liste")).sondages || []);
    } catch {
      /* silencieux */
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 20000);
    (async () => {
      try {
        const r = await fetch("/api/fripouille/config/jeux", { cache: "no-store" });
        const d = await r.json();
        const out: JeuRole[] = [];
        for (const c of d.categories || []) for (const g of c.games || []) if (g.role_id && !out.some((x) => x.role_id === String(g.role_id))) out.push({ label: g.label, role_id: String(g.role_id), emoji: g.emoji || "" });
        setJeux(out);
      } catch {
        /* silencieux */
      }
    })();
    return () => clearInterval(t);
  }, [charger]);

  if (mod.loading) return <Loading lignes={5} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const basculer = (j: JeuRole) =>
    setOptions((o) => (o.some((x) => x.role_id === j.role_id) ? o.filter((x) => x.role_id !== j.role_id) : o.length >= 20 ? o : [...o, { label: j.label, role_id: j.role_id }]));
  const creer = async () => {
    setOccupe(true);
    setNote(null);
    try {
      await action("creer", {
        question, options, ping, fin: new Date(fin).toISOString(),
        soiree: creerSoiree ? { creer: true, debut: new Date(debut).toISOString(), max } : { creer: false },
      });
      setNote("✅ Sondage publié.");
      setOptions([]);
      await charger();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    } finally {
      setOccupe(false);
    }
  };
  const agir = async (nom: "cloturer" | "annuler", s: Sondage, q: string) => {
    if (!window.confirm(q)) return;
    try {
      await action(nom, { id: s.id });
      await charger();
    } catch (e) {
      setNote(`⚠️ ${e instanceof Error ? e.message : "échec"}`);
    }
  };
  const valide = question.trim() && options.length >= 2 && fin && (!creerSoiree || debut);

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon"><Icon name="balance" /></span>
          <div>
            <h2>Nouveau sondage</h2>
            <p>Un bouton par option, une voix par membre. À la clôture, le gagnant peut devenir une soirée avec inscriptions.</p>
          </div>
        </div>
        <div className="cfg-field">
          <label>Question</label>
          <input type="text" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="cfg-field">
          <label>Options — jeux des rôles-jeux ({options.length}/20)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {jeux.map((j) => (
              <button key={j.role_id} type="button" className={`btn small ${options.some((x) => x.role_id === j.role_id) ? "on" : ""}`} onClick={() => basculer(j)}>
                {j.emoji} {j.label}
              </button>
            ))}
          </div>
        </div>
        <div className="cfg-field">
          <label>…ou une option libre</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="text" maxLength={80} value={libre} onChange={(e) => setLibre(e.target.value)} placeholder="Ex. Soirée jeux de société" />
            <button className="btn small" type="button" disabled={!libre.trim() || options.length >= 20}
              onClick={() => { setOptions((o) => [...o, { label: libre.trim(), role_id: "" }]); setLibre(""); }}>Ajouter</button>
          </div>
          {options.length > 0 && <p className="cfg-hint">Options : {options.map((o) => o.label).join(" · ")}</p>}
        </div>
        <div className="cfg-field">
          <label>Clôture du vote</label>
          <input type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={creerSoiree} onChange={(e) => setCreerSoiree(e.target.checked)} />
          <span className="switch" />
          <span>Le gagnant devient une soirée (module Soirées)</span>
        </label>
        {creerSoiree && (
          <div className="field-2col">
            <div className="cfg-field"><label>Date de la soirée</label><input type="datetime-local" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
            <div className="cfg-field"><label>Places (0 = illimité)</label><input type="text" inputMode="numeric" value={max} onChange={(e) => setMax(Number(e.target.value.replace(/\D/g, "")) || 0)} /></div>
          </div>
        )}
        <label className="cfg-toggle">
          <input type="checkbox" checked={ping} onChange={(e) => setPing(e.target.checked)} />
          <span className="switch" />
          <span>Pinger le rôle d&apos;annonce à l&apos;ouverture</span>
        </label>
        <button className="btn primary" type="button" disabled={occupe || !valide || !d.enabled || mod.dirty} onClick={creer}>🗳️ Publier le sondage</button>
        {!d.enabled && <p className="cfg-hint">Active le module dans les réglages ci-dessous (et enregistre).</p>}
        {note && <p className="cfg-hint">{note}</p>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>Sondages</h2></div>
        {liste.length === 0 ? (
          <Parchemin icone="urne" titre="Aucun sondage">Publie le premier : le gagnant peut devenir une soirée.</Parchemin>
        ) : (
          <div className="game-list">
            {liste.map((s) => {
              const total = s.options.reduce((a, o) => a + o.voix, 0);
              return (
                <div className="game-row" key={s.id} style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="game-label">
                    {s.statut === "ouvert" ? "🟢" : "🏁"} <b>{s.question}</b> — {s.votants} votant(s) · {s.statut === "ouvert" ? `clôture ${quand(s.fin)}` : "clos"}
                    <br />
                    <small>{s.options.map((o) => `${o.id === s.gagnant ? "🏆 " : ""}${o.label} ${o.voix}${total ? ` (${Math.round((100 * o.voix) / total)} %)` : ""}`).join(" · ")}</small>
                  </span>
                  {s.statut === "ouvert" && (
                    <button className="btn small" type="button" onClick={() => agir("cloturer", s, "Clore le vote maintenant ?")}>Clore</button>
                  )}
                  <button className="btn icon danger" type="button" aria-label="Supprimer" onClick={() => agir("annuler", s, "Supprimer ce sondage et sa carte Discord ?")}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head"><h2>Réglages</h2></div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer les sondages</span>
        </label>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Salon des sondages</label>
            <ChannelSelect channels={channels} value={d.channel_id} onChange={(v) => mod.patch({ channel_id: v })} />
          </div>
          <div className="cfg-field">
            <label>Rôle pingé à l&apos;ouverture</label>
            <select value={d.ping_role_id ?? ""} onChange={(e) => mod.patch({ ping_role_id: e.target.value || null })}>
              <option value="">— Aucun —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
