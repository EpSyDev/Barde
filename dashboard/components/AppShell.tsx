"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Dashboard from "@/components/Dashboard";
import Community from "@/components/Community";
import Games from "@/components/Games";
import Messages from "@/components/Messages";
import Tickets from "@/components/Tickets";
import Voice from "@/components/Voice";
import Bapteme from "@/components/Bapteme";
import Registre from "@/components/Registre";
import Media from "@/components/Media";
import Economie from "@/components/Economie";
import Accueil from "@/components/Accueil";
import Tresorerie from "@/components/Tresorerie";
import Membres from "@/components/Membres";
import Moderation from "@/components/Moderation";
import Journal from "@/components/Journal";
import Reglages from "@/components/Reglages";
import Icon from "@/components/Icon";
import { ToastProvider } from "@/components/Toasts";
import Palette from "@/components/Palette";
import { logout } from "@/app/actions";

import { SECTIONS, SECTION_DEFAUT as DEFAUT, type Section } from "@/lib/sections";

type Sante = {
  fripouille: { en_ligne: boolean; latence_ms?: number | null; membres?: number | null };
  barde: { en_ligne: boolean; a_l_antenne?: number; salons?: number };
};

/** Compteurs affichés dans le menu : uniquement ce qui appelle une action. */
type Alertes = { tickets: number; anomalies: number };

function sectionDepuisUrl(): string {
  if (typeof window === "undefined") return DEFAUT;
  const s = new URLSearchParams(window.location.search).get("s");
  return SECTIONS.some((x) => x.id === s && x.ready) ? (s as string) : DEFAUT;
}

export default function AppShell({ userName }: { userName: string }) {
  return (
    <ToastProvider>
      <Shell userName={userName} />
    </ToastProvider>
  );
}

function Shell({ userName }: { userName: string }) {
  const [active, setActive] = useState(DEFAUT);
  const [open, setOpen] = useState(false);
  const [paletteOuverte, setPaletteOuverte] = useState(false);
  const [sante, setSante] = useState<Sante | null>(null);
  const [alertes, setAlertes] = useState<Alertes>({ tickets: 0, anomalies: 0 });
  // Fiche membre demandée depuis la palette : consommée par l'écran « Membres ».
  const [membreCible, setMembreCible] = useState<string | null>(null);

  // --- Navigation : l'URL est la source de vérité (F5, retour, lien partagé) ---
  useEffect(() => {
    setActive(sectionDepuisUrl());
    const onPop = () => setActive(sectionDepuisUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const aller = useCallback((id: string, membre?: string) => {
    const section = SECTIONS.find((s) => s.id === id);
    if (!section?.ready) return;
    if (membre) setMembreCible(membre);
    setActive(id);
    setOpen(false);
    const url = id === DEFAUT ? window.location.pathname : `?s=${id}`;
    window.history.pushState({ s: id }, "", url);
  }, []);

  // --- Santé des deux bots + compteurs d'attention ---
  useEffect(() => {
    let vivant = true;
    const charger = async () => {
      try {
        const res = await fetch("/api/fripouille/health", { cache: "no-store" });
        if (vivant && res.ok) setSante(await res.json());
      } catch {
        if (vivant) setSante({ fripouille: { en_ligne: false }, barde: { en_ligne: false } });
      }
      try {
        const res = await fetch("/api/fripouille/action/membres/tableau", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!vivant || !res.ok) return;
        const data = await res.json();
        setAlertes({
          tickets: data?.tickets?.non_pris ?? 0,
          anomalies: data?.economie?.anomalies ?? 0,
        });
      } catch {
        /* pastilles absentes plutôt que fausses */
      }
    };
    charger();
    const id = setInterval(charger, 20000);
    return () => {
      vivant = false;
      clearInterval(id);
    };
  }, []);

  // --- Palette de commandes ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOuverte((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const groupes = useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const s of SECTIONS) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group)!.push(s);
    }
    return [...map.entries()];
  }, []);

  const compteur = (id: string) =>
    id === "tickets" ? alertes.tickets : id === "tresorerie" ? alertes.anomalies : 0;

  return (
    <div className={`app ${open ? "menu-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo1.webp" alt="La Taverne du Gaming" />
          <span className="crest-sub">Panneau des taverniers</span>
        </div>

        <nav className="nav" aria-label="Sections">
          {groupes.map(([groupe, items]) => (
            <div key={groupe}>
              <div className="nav-group">{groupe}</div>
              {items.map((s) => {
                const n = compteur(s.id);
                return (
                  <button
                    key={s.id}
                    className={`nav-item ${s.id === active ? "active" : ""} ${s.ready ? "" : "soon"}`}
                    onClick={() => aller(s.id)}
                    disabled={!s.ready}
                    aria-current={s.id === active ? "page" : undefined}
                    title={s.ready ? s.hint : "Bientôt disponible"}
                  >
                    <span className="nav-icon">
                      <Icon name={s.icon} />
                    </span>
                    <span className="nav-text">
                      <span className="nav-label">{s.label}</span>
                      <span className="nav-hint">{s.hint}</span>
                    </span>
                    {!s.ready && <span className="nav-badge">à venir</span>}
                    {n > 0 && <span className="nav-count">{n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="user-chip">
            <Icon name="capuche" size={15} />
            <strong>{userName}</strong>
          </span>
          <form action={logout}>
            <button type="submit" className="link">Quitter</button>
          </form>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <main className="content">
        <header className="content-head">
          <button className="burger" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <div className="head-titles">
            <h1>
              <span className="head-icon">
                <Icon name={section.icon} />
              </span>
              {section.titre || section.label}
            </h1>
            <p className="head-sub">{section.hint}</p>
          </div>
          <div className="head-aside">
            <button
              className="btn ghost small"
              onClick={() => setPaletteOuverte(true)}
              title="Recherche et navigation rapide"
            >
              <Icon name="loupe" />
              <span className="nowrap">Chercher</span>
              <span className="palette-hint">⌘K</span>
            </button>
            <StatusStrip sante={sante} />
          </div>
        </header>

        {/* `key` remonte la section : la page « se tourne » à chaque changement. */}
        <div key={active} className="page-turn">
          {active === "accueil" ? (
            <Accueil aller={aller} />
          ) : active === "bardes" ? (
            <Dashboard />
          ) : active === "communaute" ? (
            <Community />
          ) : active === "membres" ? (
            <Membres cible={membreCible} onCibleConsommee={() => setMembreCible(null)} />
          ) : active === "jeux" ? (
            <Games />
          ) : active === "messages" ? (
            <Messages />
          ) : active === "vocaux" ? (
            <Voice />
          ) : active === "economie" ? (
            <Economie />
          ) : active === "tresorerie" ? (
            <Tresorerie aller={aller} />
          ) : active === "bapteme" ? (
            <Bapteme />
          ) : active === "registre" ? (
            <Registre />
          ) : active === "moderation" ? (
            <Moderation aller={aller} />
          ) : active === "tickets" ? (
            <Tickets />
          ) : active === "journal" ? (
            <Journal aller={aller} />
          ) : active === "media" ? (
            <Media />
          ) : active === "reglages" ? (
            <Reglages />
          ) : (
            <div className="soon-panel">
              <div className="soon-icon">
                <Icon name={section.icon} />
              </div>
              <h2>{section.label}</h2>
              <p>Cette section est encore sur l&apos;établi du forgeron.</p>
            </div>
          )}
        </div>
      </main>

      {paletteOuverte && (
        <Palette
          fermer={() => setPaletteOuverte(false)}
          aller={aller}
          sectionActive={active}
        />
      )}
    </div>
  );
}

/** État des deux bots. Un bot muet le dit — il n'y a pas d'état « probablement en ligne ». */
function StatusStrip({ sante }: { sante: Sante | null }) {
  if (!sante) return null;
  const { fripouille, barde } = sante;
  return (
    <div className="status-strip">
      <span
        className={`status-pill ${barde.en_ligne ? "on" : "off"}`}
        title={barde.en_ligne ? "Bot musique joignable" : "Bot musique injoignable"}
      >
        <i />
        Bardes
        {barde.en_ligne && barde.a_l_antenne ? ` · ${barde.a_l_antenne} à l'antenne` : ""}
      </span>
      <span
        className={`status-pill ${fripouille.en_ligne ? "on" : "off"}`}
        title={
          fripouille.en_ligne
            ? `Fripouille joignable${fripouille.latence_ms != null ? ` — ${fripouille.latence_ms} ms` : ""}`
            : "Fripouille injoignable : les réglages ne partiront pas"
        }
      >
        <i />
        Fripouille
        {fripouille.en_ligne && fripouille.latence_ms != null
          ? ` · ${fripouille.latence_ms} ms`
          : ""}
      </span>
    </div>
  );
}
