"use client";

import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import Community from "@/components/Community";
import { logout } from "@/app/actions";

type Section = {
  id: string;
  label: string;
  icon: string;
  hint: string;
  ready: boolean;
};

// Le menu grandira au fil des fonctionnalités du bot.
const SECTIONS: Section[] = [
  { id: "bardes", label: "Bardes", icon: "🎵", hint: "Régie musicale", ready: true },
  { id: "communaute", label: "Communauté", icon: "🛡️", hint: "Rôles & accueil", ready: true },
  { id: "embeds", label: "Embeds & annonces", icon: "📜", hint: "Messages du Discord", ready: false },
  { id: "taverniers", label: "Taverniers", icon: "🧙", hint: "PNJ & ambiance", ready: false },
  { id: "reglages", label: "Réglages", icon: "⚙", hint: "Configuration du bot", ready: false },
];

export default function AppShell({ userName }: { userName: string }) {
  const [active, setActive] = useState("bardes");
  const [open, setOpen] = useState(false);

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  const select = (s: Section) => {
    if (!s.ready) return;
    setActive(s.id);
    setOpen(false);
  };

  return (
    <div className={`app ${open ? "menu-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo1.webp" alt="La Taverne du Gaming" />
          <span className="crest-sub">Panneau du bot</span>
        </div>

        <nav className="nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`nav-item ${s.id === active ? "active" : ""} ${s.ready ? "" : "soon"}`}
              onClick={() => select(s)}
              disabled={!s.ready}
              title={s.ready ? s.hint : "Bientôt disponible"}
            >
              <span className="nav-icon">{s.icon}</span>
              <span className="nav-text">
                <span className="nav-label">{s.label}</span>
                <span className="nav-hint">{s.hint}</span>
              </span>
              {!s.ready && <span className="nav-badge">à venir</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">🍺 {userName}</div>
          <form action={logout}>
            <button type="submit" className="link">Quitter</button>
          </form>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <main className="content">
        <header className="content-head">
          <button
            className="burger"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="head-titles">
            <h1>
              <span className="head-icon">{section.icon}</span>
              {active === "bardes" ? "Régie des Bardes" : section.label}
            </h1>
            <p className="head-sub">{section.hint}</p>
          </div>
        </header>

        {active === "bardes" ? (
          <Dashboard />
        ) : active === "communaute" ? (
          <Community />
        ) : (
          <div className="soon-panel">
            <div className="soon-icon">{section.icon}</div>
            <h2>{section.label}</h2>
            <p>Cette section est encore sur l'établi du forgeron.</p>
          </div>
        )}
      </main>
    </div>
  );
}
