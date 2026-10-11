"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { DirtyBar, Loading, Vide } from "@/components/ui";
import { useModuleConfig, useUnsavedGuard } from "@/lib/useModuleConfig";

type Role = "admin" | "mj" | "joueur";
type Membre = { id: string; nom: string; role: Role };
type Cfg = { membres: Membre[] };

const ROLES: { value: Role; label: string; aide: string }[] = [
  { value: "admin", label: "Administrateur", aide: "Tout le panneau + la table de jeu" },
  { value: "mj", label: "Maître du jeu", aide: "Table de dés + plateau, pouvoirs de MJ" },
  { value: "joueur", label: "Joueur", aide: "Table de dés + plateau uniquement" },
];

const LABELS: Record<string, string> = { membres: "Liste des accès" };

const normalize = (d: Record<string, unknown>): Cfg => ({
  membres: Array.isArray(d.membres)
    ? (d.membres as Membre[]).map((m) => ({ id: String(m.id), nom: m.nom || "", role: m.role }))
    : [],
});
const serialize = (c: Cfg) => c;

/** Qui peut entrer, et avec quel rôle. La liste vit côté bot (module « acces »). */
export default function Acces() {
  const mod = useModuleConfig<Cfg>("acces", normalize, serialize);
  useUnsavedGuard(mod.dirty);
  const [id, setId] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<Role>("joueur");
  const [erreur, setErreur] = useState<string | null>(null);

  if (mod.loading) return <Loading lignes={4} />;
  const d = mod.draft;
  if (!d) return <Vide>{mod.error || "La Fripouille est injoignable."}</Vide>;

  const ajouter = () => {
    const clean = id.trim();
    if (!/^\d{15,25}$/.test(clean)) {
      setErreur("Un identifiant Discord est un nombre de 17 à 20 chiffres (mode développeur → clic droit → Copier l'identifiant).");
      return;
    }
    if (d.membres.some((m) => m.id === clean)) {
      setErreur("Cet identifiant est déjà dans la liste.");
      return;
    }
    setErreur(null);
    mod.patch({ membres: [...d.membres, { id: clean, nom: nom.trim(), role }] });
    setId("");
    setNom("");
  };
  const maj = (i: string, patch: Partial<Membre>) =>
    mod.patch({ membres: d.membres.map((m) => (m.id === i ? { ...m, ...patch } : m)) });
  const retirer = (m: Membre) => {
    if (!window.confirm(`Retirer l'accès de ${m.nom || m.id} ?`)) return;
    mod.patch({ membres: d.membres.filter((x) => x.id !== m.id) });
  };

  const origine = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <span className="cfg-card-icon">
            <Icon name="capuche" />
          </span>
          <div>
            <h2>Accès au dashboard et à la table</h2>
            <p>
              Ajoute l&apos;identifiant Discord de chaque personne et choisis son rôle. Les personnes
              connectées voient leurs droits évoluer sous une trentaine de secondes. Les administrateurs de
              secours (variable d&apos;environnement) restent toujours admis.
            </p>
          </div>
        </div>

        {d.membres.length === 0 ? (
          <p className="cfg-hint">Aucun accès supplémentaire pour l&apos;instant.</p>
        ) : (
          <div className="game-list">
            {d.membres.map((m) => (
              <div className="game-row" key={m.id} style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="game-label">
                  <b>{m.nom || "Sans nom"}</b> <code>{m.id}</code>
                </span>
                <select value={m.role} onChange={(e) => maj(m.id, { role: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button className="btn icon danger" type="button" onClick={() => retirer(m)} aria-label="Retirer">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <h3>Ajouter une personne</h3>
        <div className="field-2col">
          <div className="cfg-field">
            <label>Identifiant Discord</label>
            <input type="text" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="cfg-field">
            <label>Nom (pour t&apos;y retrouver)</label>
            <input type="text" maxLength={60} value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
        </div>
        <div className="cfg-field">
          <label>Rôle</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.aide}
              </option>
            ))}
          </select>
        </div>
        {erreur && <p className="cfg-hint">⚠️ {erreur}</p>}
        <button className="btn primary" type="button" onClick={ajouter} disabled={!id}>
          ➕ Ajouter à la liste
        </button>
        <p className="cfg-hint">N&apos;oublie pas d&apos;enregistrer (barre du bas) pour que l&apos;accès soit effectif.</p>
      </section>

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>Adresses à donner aux joueurs</h2>
          <p>Après connexion Discord, les joueurs et MJ atterrissent directement sur la table.</p>
        </div>
        <div className="game-list">
          {[
            ["Table de jeu (plateau + dés)", `${origine}/table`],
          ].map(([titre, url]) => (
            <div className="game-row" key={url} style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="game-label">
                <b>{titre}</b> <code>{url}</code>
              </span>
              <button
                className="btn small"
                type="button"
                onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}
              >
                Copier
              </button>
            </div>
          ))}
        </div>
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
