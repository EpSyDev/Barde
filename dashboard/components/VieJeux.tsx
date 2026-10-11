"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";
import Parchemin from "@/components/Parchemin";

type Cfg = {
  enabled: boolean;
  suggestion_actif: boolean;
  suggestion_delai_min: number;
  accueil_actif: boolean;
  lfg_actif: boolean;
  lfg_cooldown_min: number;
  lfg_duree_h: number;
};
type Jeu = {
  role_id: string; label: string; emoji: string; membres: number; role_existe: boolean;
  categorie: string | null; salon: { id: string; nom: string } | null; panneau: boolean;
};
type Etat = { jeux: Jeu[]; perms: { manage_channels?: boolean; manage_roles?: boolean }; presences: boolean; suggestions: number };

const LABELS: Record<string, string> = {
  enabled: "Activation",
  suggestion_actif: "Suggestion de catégorie",
  suggestion_delai_min: "Délai avant suggestion",
  accueil_actif: "Accueil dans la catégorie",
  lfg_actif: "Qui est chaud ?",
  lfg_cooldown_min: "Intervalle entre pings",
  lfg_duree_h: "Durée d'une recherche",
};

const normalize = (d: Record<string, unknown>): Cfg => ({
  enabled: !!d.enabled,
  suggestion_actif: d.suggestion_actif !== false,
  suggestion_delai_min: Number(d.suggestion_delai_min ?? 10),
  accueil_actif: d.accueil_actif !== false,
  lfg_actif: d.lfg_actif !== false,
  lfg_cooldown_min: Number(d.lfg_cooldown_min ?? 60),
  lfg_duree_h: Number(d.lfg_duree_h ?? 3),
});
const serialize = (c: Cfg) => ({
  ...c,
  suggestion_delai_min: Math.max(1, Math.round(c.suggestion_delai_min) || 1),
  lfg_cooldown_min: Math.max(0, Math.round(c.lfg_cooldown_min) || 0),
  lfg_duree_h: Math.max(1, Math.round(c.lfg_duree_h) || 1),
});

async function action(nom: string, payload: object = {}) {
  const r = await fetch(`/api/fripouille/action/viejeux/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `Erreur ${r.status}`);
  return j;
}

/** Faire vivre les catégories de jeux : suggestion, accueil, « Qui est chaud ? ». */
export default function VieJeux() {
  const mod = useModuleConfig<Cfg>("viejeux", normalize, serialize);
  useUnsavedGuard(mod.dirty);
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
  }, [charger]);

  const lancer = async (nom: string, payload: object, ok: (j: Record<string, unknown>) => string, q?: string) => {
    if (q && !window.confirm(q)) return;
    setOccupe(true);
    setNote(null);
    try {
      setNote(`✅ ${ok(await action(nom, payload))}`);
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

  return (
    <div className="cfg-grid wide">
      {etat && !etat.presences && d.suggestion_actif && (
        <div className="edit-banner">⚠️ L&apos;intent Presence n&apos;est pas actif : la suggestion de catégorie ne peut pas voir les jeux lancés.</div>
      )}
      {etat?.perms && etat.perms.manage_channels === false && (
        <div className="edit-banner">⚠️ La Fripouille n&apos;a pas « Gérer les salons » : ni catégorie automatique, ni vocal de partie.</div>
      )}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="manette" />
          </span>
          <div>
            <h2>Faire vivre les jeux</h2>
            <p>
              Le bot repère ceux qui jouent, les invite dans la bonne catégorie, les y accueille, et leur donne un bouton
              pour trouver des partenaires de jeu.
            </p>
          </div>
        </div>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.enabled} onChange={(e) => mod.patch({ enabled: e.target.checked })} />
          <span className="switch" />
          <span>Activer</span>
        </label>

        <h3>1. Suggestion de catégorie</h3>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.suggestion_actif} onChange={(e) => mod.patch({ suggestion_actif: e.target.checked })} />
          <span className="switch" />
          <span>Proposer en MP la catégorie d&apos;un jeu auquel le membre joue sans en avoir le rôle</span>
        </label>
        {d.suggestion_actif && (
          <div className="cfg-field">
            <label>Après combien de minutes de jeu</label>
            <input type="text" inputMode="numeric" value={d.suggestion_delai_min} onChange={(e) => mod.patch({ suggestion_delai_min: num(e.target.value) })} />
            <p className="cfg-hint">
              Une seule fois par membre et par jeu, jamais pour le rôle « discret » d&apos;En ligne. Le jeu est relié au rôle-jeu
              de même nom. {etat ? `${etat.suggestions} suggestion(s) envoyée(s) jusqu'ici.` : ""}
            </p>
          </div>
        )}

        <h3>2. Accueil</h3>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.accueil_actif} onChange={(e) => mod.patch({ accueil_actif: e.target.checked })} />
          <span className="switch" />
          <span>Souhaiter la bienvenue dans le salon du jeu à qui prend le rôle (en nommant les autres joueurs, sans les pinger)</span>
        </label>

        <h3>3. Qui est chaud ?</h3>
        <label className="cfg-toggle">
          <input type="checkbox" checked={d.lfg_actif} onChange={(e) => mod.patch({ lfg_actif: e.target.checked })} />
          <span className="switch" />
          <span>Panneau « 🙋 Envie de jouer ? » dans le salon de chaque jeu</span>
        </label>
        {d.lfg_actif && (
          <div className="field-2col">
            <div className="cfg-field">
              <label>Au plus un ping du rôle toutes les (minutes)</label>
              <input type="text" inputMode="numeric" value={d.lfg_cooldown_min} onChange={(e) => mod.patch({ lfg_cooldown_min: num(e.target.value) })} />
            </div>
            <div className="cfg-field">
              <label>Une recherche reste ouverte (heures)</label>
              <input type="text" inputMode="numeric" value={d.lfg_duree_h} onChange={(e) => mod.patch({ lfg_duree_h: num(e.target.value) })} />
            </div>
          </div>
        )}
        <p className="cfg-hint">Au premier « ✋ Je suis chaud », un vocal s&apos;ouvre dans la catégorie du jeu et se supprime une fois vide.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" type="button" disabled={occupe || !d.enabled || mod.dirty}
            onClick={() => lancer("poster_panneaux", {}, (j) => {
              const sans = (j.sans_salon as string[]) || [];
              return `${j.postes} panneau(x) posté(s).${sans.length ? ` Sans salon : ${sans.join(", ")}.` : ""}`;
            })}>
            📌 Poster / remettre les panneaux
          </button>
          <button className="btn ghost" type="button" disabled={occupe}
            onClick={() => lancer("retirer_panneaux", {}, () => "Panneaux retirés.", "Retirer tous les panneaux « Qui est chaud ? » ?")}>
            Retirer les panneaux
          </button>
        </div>
        {mod.dirty && <p className="cfg-hint">Enregistre d&apos;abord tes réglages.</p>}
        {note && <p className="cfg-hint">{note}</p>}
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Jeux et leurs salons</h2>
          <p>
            Le salon d&apos;un jeu est le premier salon textuel de la catégorie ouverte à son rôle. Pas de catégorie ? Le bot peut la
            créer (réservée au rôle, avec un salon texte et un vocal).
          </p>
        </div>
        {!etat ? (
          <p className="cfg-hint">Chargement…</p>
        ) : etat.jeux.length === 0 ? (
          <Parchemin icone="manette" titre="Aucun jeu déclaré">Ajoute des jeux dans Rôles-jeux.</Parchemin>
        ) : (
          <div className="game-list">
            {etat.jeux.map((j) => (
              <div className="game-row" key={j.role_id} style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="game-label">
                  {j.emoji} <b>{j.label}</b> · {j.membres} joueur(s)
                  <br />
                  <small>
                    {!j.role_existe ? "⚠️ rôle introuvable" : j.salon ? `📁 ${j.categorie ?? "—"} › #${j.salon.nom}${j.panneau ? " · 🙋 panneau posté" : ""}` : "Pas de salon détecté"}
                  </small>
                </span>
                {j.role_existe && !j.salon && (
                  <button className="btn small" type="button" disabled={occupe}
                    onClick={() => lancer("creer_categorie", { role_id: j.role_id }, (r) => `Catégorie « ${r.categorie} » créée.`, `Créer la catégorie de ${j.label} (visible des seuls joueurs du rôle) ?`)}>
                    Créer la catégorie
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <DirtyBar dirty={mod.dirty} dirtyKeys={mod.dirtyKeys} saving={mod.saving} onSave={mod.save} onReset={mod.reset} labels={LABELS} />
    </div>
  );
}
