"use client";

// Palette de commandes (⌘K / Ctrl+K). Dix-sept sections et des centaines de champs :
// sans elle, atteindre « la boutique » demande de se souvenir qu'elle vit dans
// Économie, onglet Boutique. Ici on tape « boutique ».
//
// Elle cherche aussi les membres côté bot : taper un pseudo ouvre sa fiche. C'est le
// chemin le plus court entre « untel pose problème » et tout ce qu'on sait de lui.

import { useEffect, useMemo, useRef, useState } from "react";
import Icon, { IconName } from "@/components/Icon";
import { SECTIONS } from "@/lib/sections";

type Entree = {
  id: string;
  label: string;
  sub?: string;
  icon: IconName;
  groupe: string;
  lancer: () => void;
};

type Membre = { id: string; tag: string; nom: string; avatar: string | null };

/** Sans accents et en minuscules : « Baptême » se trouve en tapant « bapteme ». */
function pliage(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export default function Palette({
  fermer,
  aller,
  sectionActive,
}: {
  fermer: () => void;
  aller: (id: string, membre?: string) => void;
  sectionActive: string;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [membres, setMembres] = useState<Membre[]>([]);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);

  useEffect(() => champ.current?.focus(), []);

  // Recherche de membres : déclenchée à partir de 2 caractères, temporisée pour ne
  // pas interroger le bot à chaque frappe.
  useEffect(() => {
    const terme = q.trim();
    if (terme.length < 2) {
      setMembres([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/fripouille/action/membres/rechercher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: terme, limit: 6 }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setMembres(data.membres || []);
      } catch {
        setMembres([]);
      }
    }, 240);
    return () => clearTimeout(timer);
  }, [q]);

  const entrees = useMemo<Entree[]>(() => {
    const terme = pliage(q.trim());

    const navigation: Entree[] = SECTIONS.filter((s) => s.ready).map((s) => ({
      id: `nav:${s.id}`,
      label: s.titre || s.label,
      sub: s.id === sectionActive ? "section ouverte" : s.hint,
      icon: s.icon,
      groupe: "Aller à",
      lancer: () => aller(s.id),
    }));

    // Raccourcis vers des endroits précis à l'intérieur d'une section : ce sont les
    // mots qu'on a en tête (« boutique », « escalade »), pas les noms de modules.
    const raccourcis: Entree[] = [
      { id: "r:boutique", label: "Boutique", sub: "Économie", icon: "bourse", cible: "economie" },
      { id: "r:gains", label: "Sources de gains", sub: "Économie", icon: "bourse", cible: "economie" },
      { id: "r:anomalies", label: "Écarts de gains", sub: "Trésorerie", icon: "alerte", cible: "tresorerie" },
      { id: "r:geles", label: "Comptes gelés", sub: "Trésorerie", icon: "gel", cible: "tresorerie" },
      { id: "r:sanctions", label: "Sanctions récentes", sub: "Modération", icon: "balance", cible: "moderation" },
      { id: "r:escalade", label: "Règles d'escalade", sub: "Modération", icon: "balance", cible: "moderation" },
      { id: "r:recurrents", label: "Messages récurrents", sub: "Messages", icon: "clepsydre", cible: "messages" },
      { id: "r:audit", label: "Qui a changé quoi", sub: "Réglages", icon: "oeil", cible: "reglages" },
      { id: "r:sauvegarde", label: "Sauvegarder la taverne", sub: "Réglages", icon: "telecharger", cible: "reglages" },
      { id: "r:baptises", label: "Liste des baptisés", sub: "Registre", icon: "parchemin", cible: "registre" },
    ].map((r) => ({
      id: r.id,
      label: r.label,
      sub: r.sub,
      icon: r.icon as IconName,
      groupe: "Raccourcis",
      lancer: () => aller(r.cible),
    }));

    const fiches: Entree[] = membres.map((m) => ({
      id: `m:${m.id}`,
      label: m.nom,
      sub: m.tag,
      icon: "personnes",
      groupe: "Fiches membres",
      lancer: () => aller("membres", m.id),
    }));

    const filtre = (e: Entree) =>
      !terme ||
      pliage(e.label).includes(terme) ||
      pliage(e.sub || "").includes(terme);

    // Les fiches membres ne sont jamais filtrées côté client : le bot a déjà répondu
    // à la requête, tout ce qu'il renvoie est pertinent.
    return [...navigation.filter(filtre), ...raccourcis.filter(filtre), ...fiches];
  }, [q, membres, aller, sectionActive]);

  useEffect(() => setSel(0), [q, membres.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return fermer();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, entrees.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const choix = entrees[sel];
        if (choix) {
          choix.lancer();
          fermer();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entrees, sel, fermer]);

  useEffect(() => {
    liste.current
      ?.querySelector<HTMLElement>(".palette-row.sel")
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let groupeCourant = "";

  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche">
        <div className="palette-input-wrap">
          <Icon name="loupe" />
          <input
            ref={champ}
            className="palette-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Une section, un réglage, un membre…"
            aria-label="Rechercher"
          />
          <span className="palette-hint">Échap</span>
        </div>

        <div className="palette-list" ref={liste}>
          {entrees.length === 0 && (
            <div className="palette-empty">Rien sous ce nom dans la taverne.</div>
          )}
          {entrees.map((e, i) => {
            const nouveauGroupe = e.groupe !== groupeCourant;
            groupeCourant = e.groupe;
            return (
              <div key={e.id}>
                {nouveauGroupe && <div className="palette-group">{e.groupe}</div>}
                <button
                  className={`palette-row ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    e.lancer();
                    fermer();
                  }}
                >
                  <span className="palette-icon">
                    <Icon name={e.icon} />
                  </span>
                  {e.label}
                  {e.sub && <span className="palette-sub">{e.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
