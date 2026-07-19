"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = {
  id: string;
  user: string;
  name: string;
  pseudo: string;
  race: string;
  trait: string;
  style: string;
  at: string;
};

const RACE: Record<string, string> = { elfe: "Elfe", nain: "Nain", orc: "Orc", humain: "Humain" };
const TRAIT: Record<string, string> = {
  brave: "Brave", ruse: "Rusé", sage: "Sage", sombre: "Sombre", farceur: "Farceur",
};
const STYLE: Record<string, string> = {
  script: "Cursive", fraktur: "Gothique", fraktur_bold: "Gothique gras",
  smallcaps: "Petites capitales", bold: "Gras",
};

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Registre() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/fripouille/config/bapteme", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const d = await res.json();
        const roster = (d.roster || {}) as Record<string, Omit<Entry, "id">>;
        const list: Entry[] = Object.entries(roster).map(([id, v]) => ({ id, ...v }));
        list.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
        setEntries(list);
      } catch {
        setError("La Fripouille est injoignable.");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter((e) =>
      [e.name, e.user, e.id, RACE[e.race] || e.race, TRAIT[e.trait] || e.trait]
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [entries, q]);

  const exportJSON = () =>
    download(JSON.stringify(entries, null, 2), "registre-bapteme.json", "application/json");
  const exportCSV = () => {
    const head = ["id", "user", "name", "race", "trait", "style", "at"];
    const rows = (entries || []).map((e) =>
      head.map((h) => csvCell((e as unknown as Record<string, unknown>)[h])).join(",")
    );
    download([head.join(","), ...rows].join("\n"), "registre-bapteme.csv", "text/csv");
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  };

  if (error && !entries) return <div className="empty-state">{error}</div>;
  if (!entries) return <div className="empty-state">Chargement du registre…</div>;

  return (
    <div className="cfg-grid wide">
      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>📜 Registre des baptisés</h2>
          <p>
            Chaque joueur baptisé, avec son identité choisie. Base d'identification pour l'IA
            des quêtes. Données stockées côté bot (clé = ID Discord).
          </p>
        </div>

        <div className="reg-toolbar">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (nom, @, ID, race…)"
            aria-label="Rechercher"
          />
          <span className="reg-count">
            {filtered.length} / {entries.length}
          </span>
          <div className="reg-actions">
            <button className="btn" onClick={exportCSV} disabled={!entries.length}>
              Export CSV
            </button>
            <button className="btn" onClick={exportJSON} disabled={!entries.length}>
              Export JSON
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">Aucun baptisé pour l'instant.</div>
        ) : (
          <div className="table-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  <th>Pseudo</th>
                  <th>Nom</th>
                  <th>Race</th>
                  <th>Tempérament</th>
                  <th>Police</th>
                  <th>Membre</th>
                  <th>ID Discord</th>
                  <th>Baptisé le</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="reg-pseudo">{e.pseudo}</td>
                    <td>{e.name}</td>
                    <td>{RACE[e.race] || e.race}</td>
                    <td>{TRAIT[e.trait] || e.trait}</td>
                    <td>{STYLE[e.style] || e.style}</td>
                    <td>{e.user}</td>
                    <td className="reg-id">{e.id}</td>
                    <td>{fmtDate(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
