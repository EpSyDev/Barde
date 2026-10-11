"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Dashboard from "@/components/Dashboard";
import Community from "@/components/Community";
import Games from "@/components/Games";
import Messages from "@/components/Messages";
import EnLigne from "@/components/EnLigne";
import Garde from "@/components/Garde";
import Soirees from "@/components/Soirees";
import VieJeux from "@/components/VieJeux";
import Sondages from "@/components/Sondages";
import Sante from "@/components/Sante";
import Chronique from "@/components/Chronique";
import Diffusions from "@/components/Diffusions";
import Stats from "@/components/Stats";
import Acces from "@/components/Acces";
import Taches from "@/components/Taches";
import Des from "@/components/Des";
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

import Blason from "@/components/Blason";
import { QUARTIERS, SECTIONS, SECTION_DEFAUT as DEFAUT, quartierDe, type QuartierId, type Section } from "@/lib/sections";

type Sante = {
  fripouille: { en_ligne: boolean; latence_ms?: number | null; membres?: number | null };
  barde: { en_ligne: boolean; a_l_antenne?: number; salons?: number };
};

/** Compteurs affichés dans le menu : uniquement ce qui appelle une action. */
type Alertes = { tickets: number; anomalies: number; enJeu: number };

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
  const [alertes, setAlertes] = useState<Alertes>({ tickets: 0, anomalies: 0, enJeu: 0 });
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
    if (section.lien) {
      window.location.href = section.lien;
      return;
    }
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
        let enJeu = 0;
        try {
          const r2 = await fetch("/api/fripouille/action/enligne/etat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (r2.ok) enJeu = ((await r2.json())?.parties || []).filter((p: { terminee: boolean }) => !p.terminee).length;
        } catch {
          /* pas de pouls plutôt qu'un faux */
        }
        if (!vivant) return;
        setAlertes({
          tickets: data?.tickets?.non_pris ?? 0,
          anomalies: data?.economie?.anomalies ?? 0,
          enJeu,
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
  const parQuartier = useMemo(() => {
    const map = new Map<QuartierId, Section[]>();
    for (const s of SECTIONS) {
      if (!map.has(s.quartier)) map.set(s.quartier, []);
      map.get(s.quartier)!.push(s);
    }
    return map;
  }, []);
  const qActif = quartierDe(active);
  // Quartier dont l'étendard est déroulé : suit la page ouverte, mais un clic sur un
  // blason permet de parcourir un autre quartier sans quitter la page.
  const [ouvert, setOuvert] = useState<QuartierId>(qActif.id);
  useEffect(() => setOuvert(quartierDe(active).id), [active]);
  const qOuvert = QUARTIERS.find((q) => q.id === ouvert) ?? qActif;

  const compteur = (id: string) =>
    id === "tickets" ? alertes.tickets : id === "tresorerie" ? alertes.anomalies : 0;

  return (
    <div
      className={`app ${open ? "menu-open" : ""}`}
      style={{ ["--q" as string]: qActif.couleur, ["--q-fonce" as string]: qActif.fonce }}
    >
      <aside className="sidebar">
        <div className="sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo1.webp" alt="La Taverne du Gaming" />
          <span className="crest-sub">Panneau des taverniers</span>
        </div>

        <div className="quartiers">
          {/* Le rail des blasons : un écu nommé par quartier */}
          <nav className="rail" aria-label="Quartiers">
            {QUARTIERS.map((q) => {
              const n = parQuartier.get(q.id)?.reduce((t, s) => t + compteur(s.id), 0) ?? 0;
              return (
                <button
                  key={q.id}
                  className={`ecu ${q.id === ouvert ? "on" : ""} ${q.id === qActif.id ? "ici" : ""}`}
                  style={{ ["--c" as string]: q.couleur }}
                  onClick={() => setOuvert(q.id)}
                  aria-pressed={q.id === ouvert}
                  title={q.devise}
                >
                  <span className="ecu-bouclier">
                    <Blason q={q} />
                    {n > 0 && <span className="ecu-pastille">{n}</span>}
                    {q.id === "jeu" && alertes.enJeu > 0 && <span className="ecu-pouls" title={`${alertes.enJeu} partie(s) en cours`} />}
                  </span>
                  <span className="ecu-nom">{q.nom}</span>
                </button>
              );
            })}
          </nav>

          {/* L'étendard du quartier ouvert : vélin suspendu à sa hampe */}
          <div className="volet" style={{ ["--q" as string]: qOuvert.couleur, ["--q-fonce" as string]: qOuvert.fonce }}>
            <div className="hampe" />
            <div key={ouvert} className="etendard">
              <div className="etendard-titre">
                <span className="lettrine">{qOuvert.nom.replace(/^(L'|La |Le |Les )/, "")[0]}</span>
                <div>
                  <h2>{qOuvert.nom}</h2>
                  <p>{qOuvert.devise}</p>
                </div>
              </div>
              <div className="fleuron" aria-hidden="true">❦</div>
              <ul className="etendard-liste">
                {(parQuartier.get(ouvert) || []).map((s, k) => {
                  const n = compteur(s.id);
                  const etat = s.id === "tickets" && n ? `${n} en attente`
                    : s.id === "tresorerie" && n ? `${n} écart${n > 1 ? "s" : ""}`
                    : s.id === "enligne" && alertes.enJeu ? `${alertes.enJeu} en jeu` : "";
                  return (
                    <li key={s.id} style={{ ["--k" as string]: k }}>
                      <button
                        className={`onglet ${s.id === active ? "on" : ""} ${s.ready ? "" : "soon"}`}
                        onClick={() => aller(s.id)}
                        disabled={!s.ready}
                        aria-current={s.id === active ? "page" : undefined}
                      >
                        <span className="onglet-puce"><Icon name={s.icon} /></span>
                        <span className="onglet-texte">
                          <span className="onglet-nom">{s.label}{s.lien ? " ↗" : ""}</span>
                          <span className="onglet-hint">{s.ready ? s.hint : "Bientôt"}</span>
                        </span>
                        {etat && <span className={`onglet-etat ${s.id === "enligne" ? "direct" : "alerte"}`}>{etat}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button className="volet-chercher" onClick={() => setPaletteOuverte(true)}>
              <span>Aller à…</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </div>

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
            <div className="head-fil">
              {qActif.nom} <span aria-hidden="true">›</span> {section.label}
            </div>
            <h1>
              <span key={active} className="head-sceau">
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
          ) : active === "des" ? (
            <Des />
          ) : active === "taches" ? (
            <Taches />
          ) : active === "enligne" ? (
            <EnLigne />
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
          ) : active === "sondages" ? (
            <Sondages />
          ) : active === "sante" ? (
            <Sante />
          ) : active === "viejeux" ? (
            <VieJeux />
          ) : active === "chronique" ? (
            <Chronique />
          ) : active === "soirees" ? (
            <Soirees />
          ) : active === "diffusions" ? (
            <Diffusions />
          ) : active === "stats" ? (
            <Stats />
          ) : active === "acces" ? (
            <Acces />
          ) : active === "garde" ? (
            <Garde />
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
